# 🩺 PocketDoc — Offline Medical Triage Assistant

A fully offline medical triage assistant. Your phone's browser connects over WiFi to the BeagleY-AI board, which acts as the web server. You send text queries, voice recordings, or camera images of symptoms. The board relays all AI inference to your laptop over the local network, where QVAC SDK runs the LLM, Whisper STT, and RAG pipeline.

> **Architecture Note:** The BeagleY-AI board (Cortex-A53 / ARMv8.0) cannot run QVAC's native ML binaries directly (they require ARMv8.2+). So the board acts as a **lightweight web gateway**, and the laptop handles **all AI inference** via the QVAC SDK.

---

## Architecture

```
┌─────────────────────┐        WiFi         ┌─────────────────────┐
│   📱 Phone/Browser  │ ◄──────────────────► │   🔧 BeagleY-AI     │
│                     │    WebSocket/HTTP    │   (Board Server)    │
│  Text / Voice / Cam │                     │   Port 3000         │
└─────────────────────┘                     └──────────┬──────────┘
                                                       │
                                                       │ HTTP / SSE
                                                       │ (LAN)
                                                       ▼
                                            ┌──────────────────────┐
                                            │   💻 Laptop          │
                                            │   (AI Provider)      │
                                            │   Port 4000          │
                                            │                      │
                                            │   QVAC SDK:          │
                                            │   • MedPsy-4B LLM    │
                                            │   • Whisper Tiny STT  │
                                            │   • Gemma Embeddings  │
                                            │   • RAG Pipeline      │
                                            └──────────────────────┘
```

---

## Project Structure

```
pocketdoc/
├── server/                    # Runs on BeagleY-AI board
│   ├── index.js               # HTTP + WebSocket server (thin proxy)
│   ├── ai-proxy.js            # HTTP client → laptop AI provider
│   ├── logger.js              # Query logging
│   └── .env.example           # Board config
│
├── peer/                      # Runs on Laptop
│   ├── provider.js            # QVAC AI HTTP server (models + RAG)
│   └── .env.example           # Laptop config
│
├── client/                    # Web UI (served by board)
│   ├── index.html
│   ├── style.css
│   └── app.js
│
├── knowledge/                 # Medical knowledge base for RAG
│   ├── first-aid.md
│   ├── symptoms.md
│   ├── medications.md
│   └── emergency.md
│
├── scripts/
│   ├── index-knowledge.js     # RAG indexer (run on laptop)
│   └── benchmark.js           # Latency benchmark (run on laptop)
│
└── package.json
```

---

## Setup Instructions

### Prerequisites

| Machine       | Requirements                                    |
|---------------|------------------------------------------------|
| **Laptop**    | Node.js ≥ 18, macOS/Linux/Windows, 8GB+ RAM   |
| **Board**     | Node.js ≥ 18, Debian, ffmpeg installed         |
| **Phone**     | Any modern browser on the same WiFi network    |

### Step 1: Clone the repo on both machines

```bash
git clone https://github.com/devbh04/pocketdoc-beagleY.git
cd pocketdoc-beagleY
```

### Step 2: Set up the Laptop (AI Provider)

```bash
# Install laptop dependencies
cd peer
npm install

# Copy and configure environment
cp .env.example .env

# Start the AI provider (downloads models on first run ~3-5GB)
npm start
```

The provider will:
- Download and load MedPsy-4B LLM (~2.5GB)
- Download and load Whisper Tiny STT (~75MB)  
- Download and load Gemma Embedding (~200MB)
- Index the knowledge base for RAG
- Start HTTP server on port 4000

### Step 3: Set up the Board (Web Server)

```bash
# Install board dependencies (pure JS, no native binaries!)
cd server
npm install

# Copy and configure environment
cp .env.example .env

# Edit .env — set your laptop's IP address
# Find your laptop's IP with: ifconfig (macOS) or ip addr (Linux)
nano .env
```

Set in `server/.env`:
```
PORT=3000
LAPTOP_AI_URL=http://192.168.x.x:4000
```

```bash
# Start the board server
npm start
```

### Step 4: Open on your phone

1. Find the board's IP address: `hostname -I`
2. Open your phone browser and navigate to: `http://<board-ip>:3000`
3. Start querying!

---

## Features

| Feature | Input | How it works |
|---------|-------|-------------|
| **Text Triage** | Type symptoms | RAG context + MedPsy-4B streaming response |
| **Voice Triage** | Record voice | Whisper STT → RAG + LLM pipeline |
| **Camera Triage** | Photo of symptoms | Multimodal MedPsy-4B image analysis |
| **Performance Badge** | Automatic | Shows TTFT, tokens/sec, RAM usage |
| **Query Logging** | Automatic | JSONL logs in `logs/queries.jsonl` |

---

## Environment Variables

### Board (`server/.env`)
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Board HTTP server port |
| `LAPTOP_AI_URL` | `http://localhost:4000` | Laptop AI provider URL |

### Laptop (`peer/.env`)
| Variable | Default | Description |
|----------|---------|-------------|
| `PROVIDER_PORT` | `4000` | AI provider HTTP port |
| `LLM_MODEL_SRC` | MedPsy-4B HuggingFace URL | Custom GGUF model path/URL |

---

## Tech Stack

- **Board:** Express.js, WebSocket, FFmpeg
- **Laptop:** QVAC SDK, Express.js, MedPsy-4B, Whisper.cpp, Gemma Embeddings
- **Client:** Vanilla HTML/CSS/JS, mobile-first design
- **Transport:** HTTP + SSE streaming over LAN WiFi

---

## License

MIT
