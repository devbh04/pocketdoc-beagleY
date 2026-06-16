import fs from 'fs';
import path from 'path';

const logFile = path.join(process.cwd(), 'logs', 'queries.jsonl');

export function logQuery({ inputType, mode, ttftMs, tokens, tokensPerSec, ramUsedMb, queryPreview }) {
  const logEntry = {
    ts: new Date().toISOString(),
    input_type: inputType,
    mode,
    ttft_ms: ttftMs ? Math.round(ttftMs) : null,
    tokens: tokens || 0,
    tokens_per_sec: tokensPerSec ? parseFloat(tokensPerSec.toFixed(2)) : null,
    ram_used_mb: Math.round(ramUsedMb),
    query_preview: queryPreview ? queryPreview.substring(0, 60) : ''
  };

  try {
    const logsDir = path.dirname(logFile);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
    console.log(`📊 [Logger] Saved transaction: Mode=${mode.toUpperCase()} | TTFT=${logEntry.ttft_ms}ms | TPS=${logEntry.tokens_per_sec} | RAM=${logEntry.ram_used_mb}MB`);
  } catch (err) {
    console.error('[Logger] Failed to write log:', err);
  }
}
