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

import * as qvac from './qvac.js';
import { routeQuery } from './router.js';
import { logQuery } from './logger.js';

dotenv.config();

const execPromise = promisify(exec);
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

const PORT = process.env.PORT || 3000;

// Configure body parsers & uploads
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const upload = multer({ dest: path.join(os.tmpdir(), 'pocketdoc-uploads') });

// Serve client app statically
const __dirname = path.dirname(new URL(import.meta.url).pathname);
app.use(express.static(path.join(process.cwd(), 'client')));

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

// POST /query/text - Synchronous routing check & RAG answer initiator
app.post('/query/text', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Text query is required.' });

  const routing = routeQuery(text, null);
  res.json({
    message: 'Routing determined. Stream tokens via WebSocket for complete answer.',
    routing
  });
});

// POST /query/voice - Handles WAV/WEBM uploads, transcodes, and initiates Whisper
app.post('/query/voice', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Audio file is required.' });

  const tempWav = path.join(os.tmpdir(), `voice_${Date.now()}.wav`);
  try {
    // 1. Transcode input audio format (webm/m4a/ogg) to Whisper-compliant WAV
    await convertToWav(req.file.path, tempWav);
    const wavBuffer = fs.readFileSync(tempWav);

    // 2. Perform local transcription
    const { transcribedText, run } = await qvac.queryVoice(wavBuffer);
    
    // We stream the output, but for a simple POST request we can wait and send the full text
    let contentText = '';
    for await (const event of run.events) {
      if (event.type === 'contentDelta') {
        contentText += event.text;
      }
    }
    
    res.json({
      transcription: transcribedText,
      answer: contentText
    });
  } catch (err) {
    console.error('[Server Voice] Error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    // Cleanup temporary files
    try {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav);
    } catch (_) {}
  }
});

// POST /query/image - Direct image delegation endpoint
app.post('/query/image', async (req, res) => {
  const { text, image } = req.body;
  if (!image) return res.status(400).json({ error: 'Image base64 data is required.' });

  const routing = routeQuery(text, image);
  res.json({
    message: 'Image query mapped.',
    routing
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
    let run = null;
    let mode = 'local';
    let inputType = 'text';

    try {
      if (type === 'text') {
        inputType = 'text';
        // 1. Determine execution mode (local vs delegated)
        const decision = routeQuery(text, null);
        mode = decision.mode;

        // 2. Route completion
        if (mode === 'delegated') {
          run = await qvac.queryDelegate(text, null);
        } else {
          run = await qvac.queryLocal(text);
        }

      } else if (type === 'voice') {
        inputType = 'voice';
        if (!audio) throw new Error('Base64 audio payload missing.');
        
        ws.send(JSON.stringify({ type: 'status', text: 'Transcribing voice...' }));
        
        // Save base64 audio to temp file
        const tempRaw = path.join(os.tmpdir(), `raw_${Date.now()}.webm`);
        const tempWav = path.join(os.tmpdir(), `transcode_${Date.now()}.wav`);
        
        const audioBuffer = Buffer.from(audio.split(',')[1] || audio, 'base64');
        fs.writeFileSync(tempRaw, audioBuffer);
        
        // Transcode and run Whisper
        await convertToWav(tempRaw, tempWav);
        const wavBuffer = fs.readFileSync(tempWav);
        
        const voiceResult = await qvac.queryVoice(wavBuffer);
        
        // Clean up audio files
        try {
          if (fs.existsSync(tempRaw)) fs.unlinkSync(tempRaw);
          if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav);
        } catch (_) {}

        // Send back transcription
        ws.send(JSON.stringify({ type: 'transcription', text: voiceResult.transcribedText }));
        run = voiceResult.run;

      } else if (type === 'image') {
        inputType = 'image';
        if (!image) throw new Error('Base64 image payload missing.');
        
        // Vision requests always delegate to laptop
        mode = 'delegated';
        ws.send(JSON.stringify({ type: 'status', text: 'Delegating symptom image analysis...' }));
        run = await qvac.queryDelegate(text, image);

      } else {
        throw new Error(`Unsupported query type: ${type}`);
      }

      // Stream tokens back over WebSocket
      for await (const event of run.events) {
        if (event.type === 'contentDelta') {
          if (!firstTokenTime) firstTokenTime = Date.now();
          tokenCount++;
          ws.send(JSON.stringify({ type: 'token', text: event.text }));
        }
      }

      // Wait for completion run finalization to get stats
      const finalResult = await run.final;
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
        queryPreview: text || '[Voice/Image Query]'
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

// Initialize QVAC and start listening
async function start() {
  try {
    await qvac.init();
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`====================================================`);
      console.log(`🩺 PocketDoc running at: http://localhost:${PORT}`);
      console.log(`📡 Serving edge clients over LAN (0.0.0.0)`);
      console.log(`====================================================`);
    });
  } catch (err) {
    console.error('❌ Failed to start PocketDoc server:', err);
    process.exit(1);
  }
}

start();
