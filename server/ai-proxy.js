// AI Proxy — Forwards all AI requests to the laptop provider over HTTP
// No QVAC SDK needed on the board
import http from 'http';

function getLaptopUrl() {
  return process.env.LAPTOP_AI_URL || 'http://localhost:4000';
}

/**
 * Check if the laptop AI provider is reachable
 */
export function checkHealth() {
  return new Promise((resolve) => {
    try {
      const url = new URL(`${getLaptopUrl()}/api/health`);
      const req = http.get({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        timeout: 5000
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            resolve({ status: 'unreachable', error: 'Invalid JSON response' });
          }
        });
      });

      req.on('error', (err) => {
        resolve({ status: 'unreachable', error: err.message });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ status: 'unreachable', error: 'Timeout' });
      });
    } catch (err) {
      resolve({ status: 'unreachable', error: err.message });
    }
  });
}

/**
 * Text/Image query — streams tokens back via SSE from the laptop
 * Returns an async generator of events: { type, text, tokens, message }
 */
export async function* queryStream(text, imageBase64) {
  const body = {};
  if (text) body.text = text;
  if (imageBase64) body.image = imageBase64;
  const jsonBody = JSON.stringify(body);

  const url = new URL(`${getLaptopUrl()}/api/query`);
  
  const queue = [];
  let resolveNext = null;
  let finished = false;
  let error = null;

  const pushEvent = (event) => {
    queue.push(event);
    if (resolveNext) {
      resolveNext();
      resolveNext = null;
    }
  };

  const finish = () => {
    finished = true;
    if (resolveNext) {
      resolveNext();
      resolveNext = null;
    }
  };

  const fail = (err) => {
    error = err;
    finish();
  };

  const req = http.request({
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(jsonBody)
    }
  }, (res) => {
    if (res.statusCode !== 200) {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        fail(new Error(`Laptop AI error (${res.statusCode}): ${data}`));
      });
      return;
    }

    let buffer = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6));
            pushEvent(event);
          } catch (_) {}
        }
      }
    });

    res.on('end', () => {
      finish();
    });
  });

  req.on('error', (err) => {
    fail(err);
  });

  req.write(jsonBody);
  req.end();

  // Async generator consumption loop
  while (true) {
    if (queue.length > 0) {
      yield queue.shift();
    } else if (finished) {
      if (error) throw error;
      break;
    } else {
      await new Promise((resolve) => {
        resolveNext = resolve;
      });
    }
  }
}

/**
 * Voice transcription — sends audio buffer to laptop Whisper endpoint
 * Returns the transcribed text string
 */
export function transcribeAudio(wavBuffer) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(`${getLaptopUrl()}/api/transcribe`);
      const boundary = `----WebKitFormBoundary${Math.random().toString(36).substring(2)}`;

      const header = `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`;
      const footer = `\r\n--${boundary}--\r\n`;

      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': Buffer.byteLength(header) + wavBuffer.length + Buffer.byteLength(footer)
        }
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Transcription error (${res.statusCode}): ${data}`));
            return;
          }
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.text || '');
          } catch (err) {
            reject(new Error('Invalid JSON response from transcription server'));
          }
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.write(Buffer.from(header));
      req.write(wavBuffer);
      req.write(Buffer.from(footer));
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}


