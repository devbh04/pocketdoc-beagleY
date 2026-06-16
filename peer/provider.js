import { loadModel, completion, transcribe, ragSearch, ragIngest, EMBEDDINGGEMMA_300M_Q4_0, WHISPER_TINY, QWEN3VL_2B_MULTIMODAL_Q4_K, MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K } from '@qvac/sdk';
import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const execPromise = promisify(exec);
const app = express();
const PORT = process.env.PROVIDER_PORT || 4000;

app.use(express.json({ limit: '20mb' }));
const upload = multer({ dest: path.join(os.tmpdir(), 'pocketdoc-provider-uploads') });

let llmModelId = null;
let whisperModelId = null;
let embeddingModelId = null;
let isMultimodal = false;

// ─── Model Initialization ───────────────────────────────────────────

async function initModels() {
  console.log('🔄 Initializing QVAC models on laptop...\n');

  // 1. LLM
  const llmSrc = process.env.LLM_MODEL_SRC || QWEN3VL_2B_MULTIMODAL_Q4_K;

  if (llmSrc === QWEN3VL_2B_MULTIMODAL_Q4_K) {
    isMultimodal = true;
  } else if (typeof llmSrc === 'string') {
    const lower = llmSrc.toLowerCase();
    if (lower.includes('vl') || lower.includes('multimodal') || lower.includes('qwen3-vl')) {
      isMultimodal = true;
    }
  }

  const modelConfig = { ctx_size: 2048 };
  if (isMultimodal) {
    const projSrc = process.env.LLM_PROJ_SRC || MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K;
    modelConfig.projectionModelSrc = projSrc;
    console.log(`[QVAC] Loading LLM (multimodal) with projection: ${typeof projSrc === 'object' ? projSrc.name || 'default' : projSrc}`);
  } else {
    console.log(`[QVAC] Loading LLM (text-only) from: ${typeof llmSrc === 'object' ? llmSrc.name || 'default' : llmSrc}`);
  }

  llmModelId = await loadModel({
    modelSrc: llmSrc,
    modelType: 'llm',
    modelConfig,
    onProgress: (p) => process.stdout.write(`\r   LLM download: ${p.percentage.toFixed(1)}%`)
  });
  console.log(`\n✅ LLM loaded: ${llmModelId}`);

  // 2. Whisper STT
  console.log('[QVAC] Loading Whisper Tiny STT...');
  whisperModelId = await loadModel({
    modelSrc: WHISPER_TINY,
    onProgress: (p) => process.stdout.write(`\r   Whisper download: ${p.percentage.toFixed(1)}%`)
  });
  console.log(`\n✅ Whisper loaded: ${whisperModelId}`);

  // 3. Embedding model for RAG
  console.log('[QVAC] Loading Gemma Embedding for RAG...');
  embeddingModelId = await loadModel({
    modelSrc: EMBEDDINGGEMMA_300M_Q4_0,
    onProgress: (p) => process.stdout.write(`\r   Embedding download: ${p.percentage.toFixed(1)}%`)
  });
  console.log(`\n✅ Embedding loaded: ${embeddingModelId}`);

  console.log('\n✅ All models initialized!\n');
}

// ─── RAG Knowledge Indexing ─────────────────────────────────────────

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
    modelId: embeddingModelId,
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

// ─── Medical Triage Prompt Builder ──────────────────────────────────

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

// ─── Audio transcoding helper ───────────────────────────────────────

async function convertToWav(inputPath, outputPath) {
  await execPromise(`ffmpeg -i "${inputPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${outputPath}" -y`);
}

// ─── API Endpoints ──────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    models: {
      llm: !!llmModelId,
      whisper: !!whisperModelId,
      embedding: !!embeddingModelId
    }
  });
});

// POST /api/query — Text query with RAG + streaming LLM completion (SSE)
app.post('/api/query', async (req, res) => {
  const { text, image } = req.body;
  if (!text && !image) return res.status(400).json({ error: 'text or image required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    if (image && !isMultimodal) {
      throw new Error('The currently loaded model does not support image analysis. Please use a multimodal model (e.g. Qwen3VL-2B) to analyze images.');
    }
    // RAG search for context
    let ragContext = '';
    if (text && embeddingModelId) {
      try {
        const results = await ragSearch({
          modelId: embeddingModelId,
          query: text,
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

    // Handle image attachments
    let attachments = undefined;
    if (image) {
      const filename = `temp_${Date.now()}.jpg`;
      const tempDir = path.join(os.tmpdir(), 'pocketdoc-images');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      const tempPath = path.join(tempDir, filename);
      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(tempPath, Buffer.from(base64Data, 'base64'));
      attachments = [{ path: tempPath }];
    }

    const history = [
      { role: 'system', content: buildSystemPrompt(ragContext) },
      {
        role: 'user',
        content: text || 'Please review the symptom shown in the attached image.',
        ...(attachments ? { attachments } : {})
      }
    ];

    const run = completion({
      modelId: llmModelId,
      history,
      stream: true
    });

    let tokenCount = 0;
    for await (const event of run.events) {
      if (event.type === 'contentDelta') {
        tokenCount++;
        res.write(`data: ${JSON.stringify({ type: 'token', text: event.text })}\n\n`);
      }
    }

    await run.final;

    res.write(`data: ${JSON.stringify({ type: 'done', tokens: tokenCount })}\n\n`);
    res.end();

  } catch (err) {
    console.error('[Query Error]', err);
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  }
});

// POST /api/transcribe — Voice transcription via Whisper
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'audio file required' });

  const tempWav = path.join(os.tmpdir(), `whisper_${Date.now()}.wav`);

  try {
    await convertToWav(req.file.path, tempWav);
    const wavBuffer = fs.readFileSync(tempWav);

    const transcribedText = await transcribe({
      modelId: whisperModelId,
      audioChunk: wavBuffer
    });

    res.json({ text: transcribedText || '' });

  } catch (err) {
    console.error('[Transcribe Error]', err);
    res.status(500).json({ error: err.message });
  } finally {
    try {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav);
    } catch (_) {}
  }
});

// ─── Start Server ───────────────────────────────────────────────────

async function start() {
  try {
    await initModels();
    await indexKnowledge();

    app.listen(PORT, '0.0.0.0', () => {
      console.log('====================================================');
      console.log(`🧠 PocketDoc AI Provider running at: http://0.0.0.0:${PORT}`);
      console.log(`📡 Board should set LAPTOP_AI_URL=http://<your-laptop-ip>:${PORT}`);
      console.log('====================================================');
    });
  } catch (err) {
    console.error('❌ Provider startup failed:', err);
    process.exit(1);
  }
}

start();
