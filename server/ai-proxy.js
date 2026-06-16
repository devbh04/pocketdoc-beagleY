// AI Proxy — Forwards all AI requests to the laptop provider over HTTP
// No QVAC SDK needed on the board

const LAPTOP_AI_URL = process.env.LAPTOP_AI_URL || 'http://localhost:4000';

/**
 * Check if the laptop AI provider is reachable
 */
export async function checkHealth() {
  try {
    const res = await fetch(`${LAPTOP_AI_URL}/api/health`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    return data;
  } catch (err) {
    return { status: 'unreachable', error: err.message };
  }
}

/**
 * Text/Image query — streams tokens back via SSE from the laptop
 * Returns an async generator of events: { type, text, tokens, message }
 */
export async function* queryStream(text, imageBase64) {
  const body = {};
  if (text) body.text = text;
  if (imageBase64) body.image = imageBase64;

  const res = await fetch(`${LAPTOP_AI_URL}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Laptop AI error (${res.status}): ${err}`);
  }

  // Parse SSE stream
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Process complete SSE lines
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line in buffer

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const event = JSON.parse(line.slice(6));
          yield event;
        } catch (_) {}
      }
    }
  }
}

/**
 * Voice transcription — sends audio buffer to laptop Whisper endpoint
 * Returns the transcribed text string
 */
export async function transcribeAudio(wavBuffer) {
  // Build multipart form data manually using built-in FormData
  const blob = new Blob([wavBuffer], { type: 'audio/wav' });
  const formData = new FormData();
  formData.append('audio', blob, 'audio.wav');

  const res = await fetch(`${LAPTOP_AI_URL}/api/transcribe`, {
    method: 'POST',
    body: formData
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Transcription error (${res.status}): ${err}`);
  }

  const data = await res.json();
  return data.text || '';
}
