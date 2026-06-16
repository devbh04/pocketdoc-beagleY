# PocketDoc - Fully Offline Medical Triage Assistant

PocketDoc is a fully offline, local-first medical triage assistant. It runs directly on a BeagleY-AI board acting as an edge AI server. Using the QVAC SDK and local models, it transcribes voice inputs, conducts semantic search over a local RAG knowledge base, and executes MedPsy-1.7B text reasoning.

When a query exceeds the board's processing limits (complex medical terms, long word counts, or camera photos), the BeagleY-AI board automatically delegates the workload to your laptop via QVAC P2P Fabric's Holepunch DHT network.

---

## Architecture Diagram

```
                 +-----------------------------------------+
                 |              Phone Browser              |
                 +-------------------+---------------------+
                                     |
                             (WiFi / LAN Link)
                                     |
                                     v (HTTP / WebSocket)
+------------------------------------+------------------------------------+
| BeagleY-AI Server (AM67A, 4GB RAM)                                      |
|                                                                         |
|                                    +-----------------+                  |
|                                 +->| Complexity      |                  |
|                                 |  | Router          |                  |
|                                 |  +--------+--------+                  |
|                                 |           |                           |
|  +----------------+             |           v (Local Path)              |
|  | Phone Client   |             |  +-----------------+                  |
|  | View (Static)  |             |  | MedPsy-1.7B LLM |                  |
|  +----------------+             |  | (Local GGUF)    |                  |
|                                 |  +--------+--------+                  |
|  +----------------+             |           ^                           |
|  | Whisper Tiny   |             |           | (RAG Context)             |
|  | STT (Voice)    |             |  +--------+--------+                  |
|  +----------------+             |  | Gemma-300M      |                  |
|                                 |  | Embeddings / RAG|                  |
|                                 |  +-----------------+                  |
|                                 |                                       |
|                                 v (Delegated Path)                      |
|                                                                         |
|  +-------------------------------------------------------------------+  |
|  | QVAC P2P Fabric Client (Hyperswarm DHT)                           |  |
|  +---------------------------------+---------------------------------+  |
+------------------------------------+------------------------------------+
                                     |
                           (P2P Fabric Connection)
                                     |
                                     v
+------------------------------------+------------------------------------+
| Laptop Peer Provider (Hyperswarm DHT Listener)                          |
|                                                                         |
|  +-------------------------------------------------------------------+  |
|  | MedPsy-4B-Q4_K_M LLM (Fitted for high-accuracy reasoning & vision) |  |
|  +-------------------------------------------------------------------+  |
+-------------------------------------------------------------------------+
```

---

## Hardware Requirements

1. **BeagleY-AI Computer Board:**
   - TI AM67A Arm-based vision processor (Quad-core Arm Cortex-A53 @ 1.4GHz).
   - Dual C7x DSP + Matrix Multiply Accelerator (MMA) capable of 4 TOPs.
   - 4GB LPDDR4 Memory.
   - MicroSD card (16GB minimum, Class 10/UHS-1).
   - BM3301 module for WiFi 6 & Bluetooth 5.4.
2. **Laptop (P2P Compute Peer):**
   - Runs the delegated inference provider (supports Windows, macOS, or Linux).
3. **Smart Phone (Client Interface):**
   - Connected to the same WiFi network as the BeagleY-AI board.

---

## Installation & Setup

### 1. Board OS Setup
- Flash **Ubuntu 24.04 Server ARM64** onto the microSD card using Balena Etcher.
- Insert the card, connect the board to your network (Ethernet or WiFi), and boot it.
- SSH into the board: `ssh ubuntu@<board-ip>` (Default username/password: `ubuntu`/`ubuntu`).

### 2. Install Dependencies on Board
Update software repositories and install system packages:
```bash
sudo apt update
sudo apt install -y nodejs npm ffmpeg git libvulkan1 mesa-vulkan-drivers
```

Install the QVAC Command Line Interface globally to download libraries and diagnostics:
```bash
sudo npm install -g @qvac/cli
```

### 3. Verify System Health
Verify that QVAC correctly detects the board architecture and drivers:
```bash
qvac doctor
```
Ensure ARM64 Linux is identified and Vulkan loader fallback settings are configured.

---

## Workspace Setup

Clone this repository directly onto both your **BeagleY-AI Board** and your **Laptop**:
```bash
git clone https://github.com/yourusername/pocketdoc.git
cd pocketdoc
```

Install the workspace dependencies:
```bash
npm install
```

---

## How to Run

### Step 1: Create Local RAG Vector Index (Board)
Run the knowledge indexing script to chunk and embed the markdown documentation in the `knowledge/` folder:
```bash
node scripts/index-knowledge.js
```
This loads `EMBEDDINGGEMMA_300M_Q4_0`, processes documents in `knowledge/`, and creates the RAG index in `./rag-index/`.

### Step 2: Launch Peer Provider (Laptop)
Start the delegated compute listener on your laptop to expose inference capabilities:
```bash
cd peer
npm install
node provider.js
```
The console will print out a public connection key:
```
====================================================
✅ QVAC P2P Provider service started successfully!
🔑 Provider Public Key: abc123xyz456...
====================================================
```

### Step 3: Configure and Start Triage Server (Board)
On the BeagleY-AI board, copy the `PEER_PROVIDER_PUBLIC_KEY` output from the laptop, create a `server/.env` configuration:
```bash
cd server
echo "PEER_PROVIDER_PUBLIC_KEY=abc123xyz456..." > .env
npm start
```
The server will start listening at:
`🩺 PocketDoc running at: http://localhost:3000`

### Step 4: Open Mobile Client
On your phone's browser, navigate to the BeagleY-AI board's IP address:
`http://<board-ip>:3000`

- **Text Tab:** Submit questions. Simple queries run locally on-device.
- **Voice Tab:** Record symptoms. Audio is uploaded, transcoded via ffmpeg on-the-fly, transcribed with Whisper, and processed.
- **Camera Tab:** Take a photo of a skin irritation or cut. This automatically routes through QVAC P2P Fabric to execute MedPsy-4B on the laptop peer, returning visual analysis streaming in real time.

---

## Metrics & Benchmarking

Every request stores metrics in `server/logs/queries.jsonl` containing time-to-first-token (TTFT), tokens per second, RAM, and routing decisions.

To run diagnostic evaluations and verify local inference execution, run the benchmark script:
```bash
node scripts/benchmark.js
```
This script sequentially evaluates 10 pre-defined medical prompts and outputs a performance summary table in the terminal.
