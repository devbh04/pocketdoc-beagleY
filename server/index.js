import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import multer from 'multer';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

import * as ai from './ai-proxy.js';
import { logQuery } from './logger.js';
import { loadModel, completion, ragSearch, ragIngest, EMBEDDINGGEMMA_300M_Q4_0 } from '@qvac/sdk';

dotenv.config();

const execPromise = promisify(exec);
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

const PORT = process.env.PORT || 3001;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let localLlmModelId = null;
let localEmbeddingModelId = null;

function buildSystemPrompt(ragContext) {
  return `You are PocketDoc, a fully offline medical triage assistant.
Use the following local knowledge base context to answer the user's query if relevant.
Give a clear, structured triage response using the following headers:
- URGENCY LEVEL (choose from: Low, Medium, High, Emergency)
- POSSIBLE CAUSES (provide a brief list, explicitly state this is not a diagnosis)
- HOME CARE & FIRST-AID (safe first-aid and OTC guidance, do NOT suggest prescription medications)
- RED FLAGS (critical symptoms to watch out for)
- NEXT STEPS (when to see a doctor or go to the ER)

Local Knowledge Context:
${ragContext || 'No relevant local context found.'}

Be clear, professional, safe, and direct.`;
}

async function initLocalModels() {
  console.log('🔄 Initializing QVAC models locally on board...\n');

  const llmSrc = process.env.BOARD_LLM_SRC || 'https://huggingface.co/qvac/MedPsy-1.7B-GGUF/resolve/main/medpsy-1.7b-q4_k_m-imat.gguf';
  console.log(`[QVAC] Loading local LLM from: ${llmSrc}`);
  localLlmModelId = await loadModel({
    modelSrc: llmSrc,
    modelType: 'llm',
    modelConfig: { ctx_size: 2048 },
    onProgress: (p) => process.stdout.write(`\r   LLM download: ${p.percentage.toFixed(1)}%`)
  });
  console.log(`\n✅ Local LLM loaded: ${localLlmModelId}`);

  console.log('[QVAC] Loading Gemma Embedding locally for RAG...');
  localEmbeddingModelId = await loadModel({
    modelSrc: EMBEDDINGGEMMA_300M_Q4_0,
    onProgress: (p) => process.stdout.write(`\r   Embedding download: ${p.percentage.toFixed(1)}%`)
  });
  console.log(`\n✅ Local Embedding loaded: ${localEmbeddingModelId}`);

  console.log('\n✅ All local models initialized!\n');
}

async function indexKnowledge() {
  const knowledgeDir = path.join(__dirname, '..', 'knowledge');
  if (!fs.existsSync(knowledgeDir)) {
    console.log('⚠️  No knowledge/ directory found. Skipping RAG indexing.');
    return;
  }

  const files = ['first-aid.md', 'symptoms.md', 'medications.md', 'emergency.md'];
  const documents = [];

  for (const file of files) {
    const filePath = path.join(knowledgeDir, file);
    if (fs.existsSync(filePath)) {
      console.log(`📖 Reading: ${file}`);
      documents.push(fs.readFileSync(filePath, 'utf8'));
    }
  }

  if (documents.length === 0) {
    console.log('⚠️  No knowledge documents found.');
    return;
  }

  console.log('📥 Ingesting documents into RAG workspace "pocketdoc"...');
  const result = await ragIngest({
    modelId: localEmbeddingModelId,
    documents,
    workspace: 'pocketdoc',
    chunk: true,
    chunkOpts: { chunkSize: 500, chunkOverlap: 100, chunkStrategy: 'paragraph' },
    onProgress: (stage, current, total) => {
      console.log(`   [RAG] ${stage}: ${current}/${total}`);
    }
  });

  console.log(`✅ RAG indexed: ${result.processed.length} chunks\n`);
}

// Configure body parsers & uploads
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const upload = multer({ dest: path.join(os.tmpdir(), 'pocketdoc-uploads') });

// Serve client app statically
app.use(express.static(path.join(__dirname, '..', 'client')));

// Fallback to explicitly serve index.html for root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// Helper to calculate server RAM RSS in MB
function getRamUsage() {
  return process.memoryUsage().rss / 1024 / 1024;
}

// Transcode audio file to 16kHz mono WAV for Whisper
async function convertToWav(inputPath, outputPath) {
  try {
    await execPromise(`ffmpeg -i "${inputPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${outputPath}" -y`);
    console.log(`[FFmpeg] Transcoded audio to WAV: ${outputPath}`);
  } catch (err) {
    console.error('[FFmpeg] Transcoding failed:', err);
    throw new Error('Audio conversion failed. Make sure ffmpeg is installed.');
  }
}

// GET /api/status — Check board + laptop status
app.get('/api/status', async (req, res) => {
  const health = await ai.checkHealth();
  res.json({
    board: 'online',
    laptop: health
  });
});

// Upgrade HTTP to WebSockets at /stream
server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url, `http://${request.headers.host}`);
  if (pathname === '/stream') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Handle WebSocket streams
wss.on('connection', (ws) => {
  console.log('[WS] Client connected to triage stream');

  ws.on('message', async (message) => {
    let payload;
    try {
      payload = JSON.parse(message);
    } catch (err) {
      return ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON payload.' }));
    }

    const { type, text, audio, image } = payload;
    const startTime = Date.now();
    let firstTokenTime = null;
    let tokenCount = 0;
    let mode = 'delegated';
    let inputType = 'text';

    try {
      let queryText = text;

      // ── Voice: transcode & transcribe via laptop ──
      if (type === 'voice') {
        inputType = 'voice';
        if (!audio) throw new Error('Base64 audio payload missing.');

        ws.send(JSON.stringify({ type: 'status', text: 'Transcribing voice on laptop...' }));

        // Save base64 audio to temp file
        const tempRaw = path.join(os.tmpdir(), `raw_${Date.now()}.webm`);
        const tempWav = path.join(os.tmpdir(), `transcode_${Date.now()}.wav`);

        const audioBuffer = Buffer.from(audio.split(',')[1] || audio, 'base64');
        fs.writeFileSync(tempRaw, audioBuffer);

        // Transcode to WAV
        await convertToWav(tempRaw, tempWav);
        const wavBuffer = fs.readFileSync(tempWav);

        // Clean up temp files
        try {
          if (fs.existsSync(tempRaw)) fs.unlinkSync(tempRaw);
          if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav);
        } catch (_) {}

        // Transcribe via laptop
        queryText = await ai.transcribeAudio(wavBuffer);
        ws.send(JSON.stringify({ type: 'transcription', text: queryText }));

        if (!queryText || queryText.trim() === '') {
          throw new Error('Transcription returned empty. Please speak clearly and try again.');
        }
      }

      // ── Image ──
      if (type === 'image') {
        inputType = 'image';
        if (!image) throw new Error('Base64 image payload missing.');
        ws.send(JSON.stringify({ type: 'status', text: 'Analyzing symptom image on laptop...' }));
      }

      if (type === 'text') {
        inputType = 'text';
        ws.send(JSON.stringify({ type: 'status', text: 'Processing query locally on board...' }));
      }

      if (type === 'image') {
        mode = 'delegated';
        const imagePayload = image;
        for await (const event of ai.queryStream(queryText, imagePayload)) {
          if (event.type === 'token') {
            if (!firstTokenTime) firstTokenTime = Date.now();
            tokenCount++;
            ws.send(JSON.stringify({ type: 'token', text: event.text }));
          } else if (event.type === 'done') {
            tokenCount = event.tokens || tokenCount;
          } else if (event.type === 'error') {
            throw new Error(event.message);
          }
        }
      } else {
        mode = 'local';
        let ragContext = '';
        if (queryText && localEmbeddingModelId) {
          try {
            const results = await ragSearch({
              modelId: localEmbeddingModelId,
              query: queryText,
              topK: 3,
              workspace: 'pocketdoc'
            });
            if (results && results.length > 0) {
              ragContext = results.map(r => r.content).join('\n\n');
            }
          } catch (err) {
            console.error('[RAG] Search failed:', err.message);
          }
        }

        const history = [
          { role: 'system', content: buildSystemPrompt(ragContext) },
          { role: 'user', content: queryText }
        ];

        const run = completion({
          modelId: localLlmModelId,
          history,
          stream: true
        });

        for await (const event of run.events) {
          if (event.type === 'contentDelta') {
            if (!firstTokenTime) firstTokenTime = Date.now();
            tokenCount++;
            ws.send(JSON.stringify({ type: 'token', text: event.text }));
          }
        }

        await run.final;
      }

      // Calculate performance metrics
      const ttft = firstTokenTime ? (firstTokenTime - startTime) : 0;
      const duration = (Date.now() - startTime) / 1000;
      const tps = duration > 0 ? (tokenCount / duration) : 0;
      const ram = getRamUsage();

      // Log transaction
      logQuery({
        inputType,
        mode,
        ttftMs: ttft,
        tokens: tokenCount,
        tokensPerSec: tps,
        ramUsedMb: ram,
        queryPreview: queryText || '[Voice/Image Query]'
      });

      // Send performance metadata
      ws.send(JSON.stringify({
        type: 'metadata',
        metadata: {
          mode,
          ttft_ms: ttft,
          tokens_per_sec: tps,
          ram_mb: ram
        }
      }));

      ws.send(JSON.stringify({ type: 'done' }));

    } catch (err) {
      console.error('[WS Error]', err);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });

  ws.on('close', () => {
    console.log('[WS] Client disconnected');
  });
});

// Initialize and start listening
async function start() {
  try {
    await initLocalModels();
    await indexKnowledge();
  } catch (err) {
    console.error('❌ Board local model initialization failed:', err);
  }

  // Check if laptop AI provider is reachable
  const health = await ai.checkHealth();
  if (health.status === 'unreachable') {
    console.warn('====================================================');
    console.warn(`⚠️  Laptop AI provider is not reachable at: ${process.env.LAPTOP_AI_URL || 'http://localhost:4000'}`);
    console.warn('   Make sure to start the provider on your laptop for Camera triage.');
    console.warn('====================================================');
  } else {
    console.log(`✅ Laptop AI provider connected for Camera delegation: ${JSON.stringify(health)}`);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log('====================================================');
    console.log(`🩺 PocketDoc running at: http://localhost:${PORT}`);
    console.log(`📡 Serving clients over LAN (0.0.0.0)`);
    console.log(`📂 Static assets path: ${path.join(__dirname, '..', 'client')}`);
    console.log(`🧠 Local Board AI: MedPsy-1.7B`);
    console.log(`🧠 Delegated Laptop AI: ${process.env.LAPTOP_AI_URL || 'http://localhost:4000'}`);
    console.log('====================================================');
  });
}

start();
