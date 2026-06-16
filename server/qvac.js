import { loadModel, completion, transcribe, EMBEDDINGGEMMA_300M_Q4_0, WHISPER_TINY, ragSearch } from '@qvac/sdk';
import fs from 'fs';
import path from 'path';

let localModelId = null;
let whisperModelId = null;
let embeddingModelId = null;

// Initialize models: load MedPsy-1.7B, Whisper Tiny, and Gemma Embedding models
export async function init() {
  console.log('🔄 Initializing QVAC Core on BeagleY-AI...');

  // 1. Load Local LLM (MedPsy-1.7B-Q4_K_M)
  const medpsySrc = process.env.MEDPSY_1_7B_Q4 || 'https://huggingface.co/qvac/MedPsy-1.7B-GGUF/resolve/main/MedPsy-1.7B-Q4_K_M.gguf';
  console.log(`[QVAC] Loading MedPsy LLM from: ${medpsySrc}`);
  
  try {
    localModelId = await loadModel({
      modelSrc: medpsySrc,
      modelType: 'llm',
      modelConfig: { ctx_size: 2048 }
    });
    console.log(`[QVAC] MedPsy LLM loaded successfully with ID: ${localModelId}`);
  } catch (err) {
    console.error('[QVAC] Error loading MedPsy LLM:', err);
    throw err;
  }

  // 2. Load Whisper STT (WHISPER_TINY)
  console.log('[QVAC] Loading Whisper Tiny STT model...');
  try {
    whisperModelId = await loadModel({
      modelSrc: WHISPER_TINY
    });
    console.log(`[QVAC] Whisper STT loaded successfully with ID: ${whisperModelId}`);
  } catch (err) {
    console.error('[QVAC] Error loading Whisper STT:', err);
    throw err;
  }

  // 3. Load Gemma Embedding (EMBEDDINGGEMMA_300M_Q4_0)
  console.log('[QVAC] Loading Gemma Embedding model for RAG...');
  try {
    embeddingModelId = await loadModel({
      modelSrc: EMBEDDINGGEMMA_300M_Q4_0
    });
    console.log(`[QVAC] Gemma Embedding loaded successfully with ID: ${embeddingModelId}`);
  } catch (err) {
    console.error('[QVAC] Error loading Embedding model:', err);
    throw err;
  }

  console.log('✅ QVAC Core initialization complete!');
}

// Text Query Pipeline: RAG search -> Local MedPsy completion
export async function queryLocal(text) {
  if (!localModelId || !embeddingModelId) {
    throw new Error('QVAC models are not fully initialized.');
  }

  console.log(`[QVAC] Running local query pipeline for: "${text.substring(0, 40)}..."`);
  
  // 1. Perform semantic search over local medical RAG index
  let contextText = '';
  try {
    const results = await ragSearch({
      modelId: embeddingModelId,
      query: text,
      topK: 3,
      workspace: 'pocketdoc'
    });
    
    if (results && results.length > 0) {
      console.log(`[QVAC RAG] Found ${results.length} relevant chunks`);
      contextText = results.map(r => r.content).join('\n\n');
    } else {
      console.log('[QVAC RAG] No relevant context found.');
    }
  } catch (err) {
    console.error('[QVAC RAG] Search failed:', err);
  }

  // 2. Build structured medical triage prompt
  const systemPrompt = `You are PocketDoc, a fully offline medical triage assistant.
Use the following local knowledge base context to answer the user's query if relevant.
Give a clear, structured triage response using the following headers:
- URGENCY LEVEL (choose from: Low, Medium, High, Emergency)
- POSSIBLE CAUSES (provide a brief list, explicitly state this is not a diagnosis)
- HOME CARE & FIRST-AID (safe first-aid and OTC guidance, do NOT suggest prescription medications)
- RED FLAGS (critical symptoms to watch out for)
- NEXT STEPS (when to see a doctor or go to the ER)

Local Knowledge Context:
${contextText || 'No relevant local context found.'}

Be clear, professional, safe, and direct.`;

  // 3. Trigger streaming text completion
  const run = completion({
    modelId: localModelId,
    history: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text }
    ],
    stream: true
  });

  return run;
}

// Voice Query Pipeline: Transcribe WAV audio buffer -> Local query pipeline
export async function queryVoice(wavBuffer) {
  if (!whisperModelId) {
    throw new Error('Whisper model is not initialized.');
  }

  console.log('[QVAC] Transcribing voice audio buffer...');
  const transcribedText = await transcribe({
    modelId: whisperModelId,
    audioChunk: wavBuffer
  });

  console.log(`[QVAC] Transcribed voice text: "${transcribedText}"`);
  if (!transcribedText || transcribedText.trim() === '') {
    throw new Error('Audio transcription failed or returned empty text. Please speak clearly.');
  }

  // Route transcribed text to local RAG + MedPsy pipeline
  const run = await queryLocal(transcribedText);
  return {
    transcribedText,
    run
  };
}

// Delegated Query Pipeline: Delegate query to Laptop peer over QVAC Fabric P2P
export async function queryDelegate(text, imageBase64) {
  const providerPublicKey = process.env.PEER_PROVIDER_PUBLIC_KEY;
  if (!providerPublicKey) {
    throw new Error('PEER_PROVIDER_PUBLIC_KEY is not defined in .env.');
  }

  console.log(`[QVAC] Delegating query to laptop peer (Key: ${providerPublicKey.substring(0, 10)}...)`);

  // Handle optional image attachments
  let attachments = null;
  if (imageBase64) {
    const filename = `temp_${Date.now()}.jpg`;
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const tempPath = path.join(tempDir, filename);
    // Strip base64 data URL header if present
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(tempPath, buffer);
    attachments = [{ path: tempPath }];
    console.log(`[QVAC] Saved delegation image to: ${tempPath}`);
  }

  // Load the delegated model using the provider's public key
  // This instructs QVAC Fabric to route completions of this modelId to the laptop
  const peerModelId = await loadModel({
    modelSrc: 'https://huggingface.co/qvac/MedPsy-4B-GGUF/resolve/main/MedPsy-4B-Q4_K_M.gguf',
    modelType: 'llm',
    delegate: {
      providerPublicKey,
      timeout: 60_000,
      fallbackToLocal: true
    }
  });

  console.log(`[QVAC] Registered delegated model ID: ${peerModelId}`);

  // Trigger streaming completion on the delegated model
  const run = completion({
    modelId: peerModelId,
    history: [
      {
        role: 'user',
        content: text || 'Please review the symptom shown in the attached image.',
        ...(attachments ? { attachments } : {})
      }
    ],
    stream: true
  });

  return run;
}
