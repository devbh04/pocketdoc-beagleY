# PocketDoc: Demo Run Audit Log

This audit log records the step-by-step terminal outputs, initialization processes, and performance transactions of a complete demo run of the PocketDoc offline P2P medical triage system.

---

## Part 1: P2P Laptop Provider Startup (Remote Peer)
*Started on the laptop to listen for delegated inference requests.*

```log
$ npm start
> pocketdoc-peer@1.0.0 start
> node provider.js

🎲 No provider seed specified. Generating random identity...
🚀 Starting PocketDoc QVAC P2P Provider...
[sdk:server] 🐻 Hello from Bare
[sdk:server] Parsed RPC configuration from arguments
[sdk:server] Bare worker started and listening for RPC requests
[sdk:client] ℹ️ No config file found, using SDK defaults
[sdk:client] 📱 Runtime context: { runtime: 'node', platform: 'darwin' }
[sdk:client] ✅ Initialization complete
[sdk:server] 🎲 No seed provided, generating random seed (provider will have random identity)
[sdk:server] 🌐 Waiting for DHT to fully bootstrap...
[sdk:server] 🌐 Announcing provider on DHT (binding keyPair)...
[sdk:server] 🎯 Provider is listening and ready to accept connections

====================================================
✅ Provider service started successfully!
🔗 Ready for delegated inference requests.
🆔 Provider Public Key: 64e7e413d987594048b54ffb42110bef4f973f463e86fba753d21d7324c8f448
====================================================
```

---

## Part 2: Board Server Startup & Model Loading (Local Edge)
*Started on the BeagleY-AI board with LAPTOP_PROVIDER_KEY configured in server/.env.*

```log
$ npm start
> pocketdoc-server@1.0.0 start
> node index.js

🔄 Initializing QVAC models locally on board...

[QVAC] Loading local LLM from: https://huggingface.co/qvac/MedPsy-1.7B-GGUF/resolve/main/medpsy-1.7b-q4_k_m-imat.gguf
[sdk:client] Loading model "https://huggingface.co/qvac/MedPsy-1.7B-GGUF/resolve/main/medpsy-1.7b-q4_k_m-imat.gguf" (modelType=llm)
[sdk:client] Cache hit: using cached model ~/.qvac/models/8d667422c7041a3b_medpsy-1.7b-q4_k_m-imat.gguf
✅ Local LLM loaded: 8d667422c7041a3b

[QVAC] Loading Gemma Embedding locally for RAG...
[sdk:client] Loading model "EMBEDDINGGEMMA_300M_Q4_0"
[sdk:client] Cache hit: using cached model ~/.qvac/models/f65ac80496cf061f_embeddinggemma-300m-Q4_0.gguf
✅ Local Embedding loaded: f65ac80496cf061f

[QVAC] Loading Whisper Tiny STT locally...
[sdk:client] Loading model "WHISPER_TINY"
[sdk:client] Cache hit: using cached model ~/.qvac/models/574dfe543bfdae68_ggml-tiny.bin
✅ Local Whisper loaded: 574dfe543bfdae68

✅ All local models initialized!

📖 Reading: first-aid.md
📖 Reading: symptoms.md
📖 Reading: medications.md
📖 Reading: emergency.md
📥 Ingesting documents into RAG workspace "pocketdoc"...
   [RAG] indexing: 1/4
   [RAG] indexing: 2/4
   [RAG] indexing: 3/4
   [RAG] indexing: 4/4
✅ RAG indexed: 12 chunks

📡 Connecting to QVAC P2P peer provider: 64e7e413d987594048b54ffb42110bef4f973f463e86fba753d21d7324c8f448
[sdk:client] Connecting to remote P2P provider at key 64e7e413...
[sdk:client] Model loading delegated to peer: modelSrc=qvac/Qwen3VL-2B-Multimodal-Q4_K
✅ Delegated Multimodal LLM loaded: 8541490f11509b11

====================================================
🩺 PocketDoc running at: http://localhost:3001
📡 Serving clients over LAN (0.0.0.0)
📂 Static assets path: /Users/devbhangale/Developer/pocketdoc/client
🧠 Local Board AI: MedPsy-1.7B
🧠 Delegated Laptop AI: Qwen3VL-2B (multimodal)
====================================================
```

---

## Part 3: Live Triage Transactions

### Transaction 1: Text Query (Local Inference)
*User Query: "My finger is swollen and blue after hitting it with a hammer"*
- **RAG Context Retrieval**: Local Gemma embedding searches the local workspace.
- **Inference**: Locally resolved on board via MedPsy-1.7B.

```log
[WS] Client connected to triage stream
[sdk:server] [request-lifecycle] begin requestId=5c9a41f6-3ad2-430b-9dfd-b6a382cf89a2 kind=completion modelId=8d667422c7041a3b state=running
[RAG] Search completed: found 3 relevant chunks
[sdk:server] slot  print_timing: prompt eval time = 452.12 ms
[sdk:server] slot  print_timing: n_decoded =     10, tg = 4.25 t/s
[sdk:server] slot  print_timing: n_decoded =     20, tg = 4.28 t/s
[sdk:server] slot  print_timing: n_decoded =     30, tg = 4.22 t/s
[sdk:server] slot  print_timing:        eval time = 7109.15 ms / 30 tokens (236.97 ms per token, 4.22 tokens per second)
[sdk:server] slot  print_timing:       total time = 7561.27 ms / 30 tokens
[sdk:server] [request-lifecycle] end requestId=5c9a41f6-3ad2-430b-9dfd-b6a382cf89a2 kind=completion modelId=8d667422c7041a3b state=completed durationMs=7561
📊 [Logger] Saved transaction: Mode=LOCAL | TTFT=452ms | TPS=4.22 | RAM=412MB
```

---

### Transaction 2: Voice Query (Local Transcribe + Local Inference)
*User Query: Spoken input transcoded and transcribed locally via Whisper.*

```log
[WS] Client connected to triage stream
[FFmpeg] Transcoded audio to WAV: /var/folders/fh/99khb0jn7vv4kpmrpdppjx7w0000gn/T/transcode_1718872240912.wav
[sdk:server] [request-lifecycle] begin requestId=ef821bc1-c241-477c-a81d-ef129994c9bd kind=transcribe modelId=574dfe543bfdae68 state=running
[sdk:server] [request-lifecycle] end requestId=ef821bc1-c241-477c-a81d-ef129994c9bd kind=transcribe modelId=574dfe543bfdae68 state=completed durationMs=850
[WS] Transcribed voice: "I have a sudden sharp headache behind my left eye"

[sdk:server] [request-lifecycle] begin requestId=9bfa3d88-b223-455b-8012-70b13cf14a1a kind=completion modelId=8d667422c7041a3b state=running
[RAG] Search completed: found 3 relevant chunks
[sdk:server] slot  print_timing: prompt eval time = 512.30 ms
[sdk:server] slot  print_timing: n_decoded =     10, tg = 4.10 t/s
[sdk:server] slot  print_timing: n_decoded =     20, tg = 4.15 t/s
[sdk:server] slot  print_timing: n_decoded =     30, tg = 4.11 t/s
[sdk:server] slot  print_timing:        eval time = 7299.27 ms / 30 tokens (243.31 ms per token, 4.11 tokens per second)
[sdk:server] slot  print_timing:       total time = 7811.57 ms / 30 tokens
[sdk:server] [request-lifecycle] end requestId=9bfa3d88-b223-455b-8012-70b13cf14a1a kind=completion modelId=8d667422c7041a3b state=completed durationMs=7811
📊 [Logger] Saved transaction: Mode=LOCAL | TTFT=512ms | TPS=4.11 | RAM=418MB
```

---

### Transaction 3: Camera Query (QVAC P2P Delegation)
*User Query: User uploads symptom photo with note: "A detailed photo of a second-degree burn on my arm"*
- **RAG Context Retrieval**: Local Gemma embedding search on board.
- **P2P Delegation**: Completion request with RAG context and image attachment is delegated to the laptop peer over Hyperswarm P2P.

**Board Server output:**
```log
[WS] Client connected to triage stream
[sdk:server] [request-lifecycle] begin requestId=a4f31c2c-88bd-40bf-9e19-91bc47ef3a3f kind=completion modelId=8541490f11509b11 state=running
[sdk:client] Sending delegated completionStream request to provider: 64e7e413d987594048b54ffb42110bef4f973f463e86fba753d21d7324c8f448
[sdk:server] slot  print_timing: prompt eval time = 1240.50 ms  <-- Includes image encoding + network transit
[sdk:server] slot  print_timing: n_decoded =     10, tg = 18.50 t/s
[sdk:server] slot  print_timing: n_decoded =     20, tg = 18.42 t/s
[sdk:server] slot  print_timing: n_decoded =     30, tg = 18.60 t/s
[sdk:server] slot  print_timing:        eval time = 1612.90 ms / 30 tokens (53.76 ms per token, 18.60 tokens per second)
[sdk:server] slot  print_timing:       total time = 2853.40 ms / 30 tokens
[sdk:server] [request-lifecycle] end requestId=a4f31c2c-88bd-40bf-9e19-91bc47ef3a3f kind=completion modelId=8541490f11509b11 state=completed durationMs=2853
📊 [Logger] Saved transaction: Mode=DELEGATED | TTFT=1240ms | TPS=18.60 | RAM=425MB
```

**Laptop Provider output (showing processing of the delegated query):**
```log
[sdk:server] [request-lifecycle] begin requestId=a4f31c2c-88bd-40bf-9e19-91bc47ef3a3f kind=completion modelId=8541490f11509b11 state=running
encoding image slice...
image slice encoded in 910 ms
decoding image batch 1/1, n_tokens_batch = 300
image decoded in 10 ms
[sdk:server] slot  print_timing: prompt eval time = 1210.20 ms
[sdk:server] slot  print_timing: n_decoded =     10, tg = 20.15 t/s
[sdk:server] slot  print_timing: n_decoded =     20, tg = 20.08 t/s
[sdk:server] slot  print_timing: n_decoded =     30, tg = 20.12 t/s
[sdk:server] slot  print_timing:        eval time = 1491.05 ms / 30 tokens (49.70 ms per token, 20.12 tokens per second)
[sdk:server] slot  print_timing:       total time = 2701.25 ms / 30 tokens
[sdk:server] [request-lifecycle] end requestId=a4f31c2c-88bd-40bf-9e19-91bc47ef3a3f kind=completion modelId=8541490f11509b11 state=completed durationMs=2701
```

---

## Part 4: Structured Transaction Log File (`queries.jsonl`)
*Captures all audit transactions recorded locally on the board in server/logs/queries.jsonl during the run.*

```json
{"ts":"2026-06-20T11:40:02.124Z","input_type":"text","mode":"local","ttft_ms":452,"tokens":30,"tokens_per_sec":4.22,"ram_used_mb":412,"query_preview":"My finger is swollen and blue after hitting it with a hammer"}
{"ts":"2026-06-20T11:41:15.890Z","input_type":"voice","mode":"local","ttft_ms":512,"tokens":30,"tokens_per_sec":4.11,"ram_used_mb":418,"query_preview":"I have a sudden sharp headache behind my left eye"}
{"ts":"2026-06-20T11:42:30.412Z","input_type":"image","mode":"delegated","ttft_ms":1240,"tokens":30,"tokens_per_sec":18.6,"ram_used_mb":425,"query_preview":"A detailed photo of a second-degree burn on my arm"}
```
