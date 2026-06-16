// Tab Switching Logic
const tabs = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));
    
    tab.classList.add('active');
    const target = document.getElementById(tab.dataset.tab);
    target.classList.add('active');

    // Stop camera if leaving camera tab
    if (tab.dataset.tab !== 'camera-tab') {
      stopCamera();
    } else {
      startCamera();
    }
  });
});

// Character Counter for Text Query
const textQueryInput = document.getElementById('text-query-input');
const charCount = document.getElementById('char-count');

textQueryInput.addEventListener('input', () => {
  charCount.textContent = textQueryInput.value.length;
});

// Global Socket and UI Elements
let socket = null;
const responseArea = document.getElementById('response-area');
const responseText = document.getElementById('response-text');
const streamStatus = document.getElementById('stream-status');
const statsBadge = document.getElementById('stats-badge');
const transcriptionPreview = document.getElementById('transcription-preview');
const transcriptionText = transcriptionPreview.querySelector('.transcription-text');

// Connect to WebSocket and initiate streaming
function startTriageStream(payload) {
  // Reset UI
  responseArea.style.display = 'block';
  responseText.innerHTML = '<div class="loading-tokens">Waiting for server...</div>';
  streamStatus.textContent = 'Connecting...';
  transcriptionPreview.style.display = 'none';
  statsBadge.style.display = 'none';
  
  // Scroll to response area
  responseArea.scrollIntoView({ behavior: 'smooth' });

  // Establish WebSocket connection
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/stream`;
  
  if (socket) {
    socket.close();
  }

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    streamStatus.textContent = 'Processing...';
    socket.send(JSON.stringify(payload));
  };

  let fullResponseText = '';

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'status') {
      streamStatus.textContent = data.text;
    } else if (data.type === 'transcription') {
      transcriptionPreview.style.display = 'block';
      transcriptionText.textContent = data.text;
    } else if (data.type === 'token') {
      if (responseText.querySelector('.loading-tokens')) {
        responseText.innerHTML = '';
      }
      fullResponseText += data.text;
      responseText.innerHTML = parseMedicalResponse(fullResponseText);
    } else if (data.type === 'metadata') {
      displayStats(data.metadata);
    } else if (data.type === 'done') {
      streamStatus.textContent = 'Ready';
      socket.close();
    } else if (data.type === 'error') {
      streamStatus.textContent = 'Error';
      responseText.innerHTML = `<span style="color: var(--color-danger);">Error: ${data.message}</span>`;
      socket.close();
    }
  };

  socket.onerror = (err) => {
    console.error('Socket error:', err);
    streamStatus.textContent = 'Connection Error';
    responseText.innerHTML = `<span style="color: var(--color-danger);">Failed to stream response from server. Check network connection.</span>`;
  };
}

// Display performance metrics stats in the badge
function displayStats(meta) {
  statsBadge.style.display = 'inline-flex';
  statsBadge.className = 'stats-badge ' + meta.mode;
  
  const modeSpan = statsBadge.querySelector('.badge-mode');
  const ttftSpan = statsBadge.querySelector('.badge-ttft');
  const tpsSpan = statsBadge.querySelector('.badge-tps');
  const ramSpan = statsBadge.querySelector('.badge-ram');

  modeSpan.textContent = meta.mode === 'delegated' ? 'Delegated · laptop' : 'Local';
  ttftSpan.textContent = `TTFT: ${meta.ttft_ms}ms`;
  tpsSpan.textContent = `${meta.tokens_per_sec.toFixed(1)} t/s`;
  ramSpan.textContent = `RAM: ${Math.round(meta.ram_mb)}MB`;
}

// Simple Custom Parser for medical formatting
function parseMedicalResponse(text) {
  const lines = text.split('\n');
  let html = '';
  let inList = false;

  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
      continue;
    }

    // Process bold text
    let formattedLine = trimmed.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Section Headers
    if (trimmed.startsWith('###') || trimmed.startsWith('##') || trimmed.startsWith('#')) {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
      const headerText = trimmed.replace(/^#+\s*/, '');
      html += `<h3>${headerText}</h3>`;
    } else if (trimmed.match(/^[A-Z\s\-]+:$/)) {
      // Handles "URGENCY LEVEL:" or "POSSIBLE CAUSES:"
      if (inList) {
        html += '</ul>';
        inList = false;
      }
      const headerText = trimmed.replace(/:$/, '');
      html += `<h3>${headerText}</h3>`;
    } 
    // Bullet Lists
    else if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
      if (!inList) {
        html += '<ul>';
        inList = true;
      }
      const itemText = formattedLine.replace(/^[-*]\s*/, '');
      html += `<li>${itemText}</li>`;
    } 
    // Normal Paragraphs
    else {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
      html += `<p>${formattedLine}</p>`;
    }
  }

  if (inList) {
    html += '</ul>';
  }

  return html;
}

// ----------------------------------------------------
// Text Mode Handler
// ----------------------------------------------------
const btnSendText = document.getElementById('btn-send-text');
btnSendText.addEventListener('click', () => {
  const query = textQueryInput.value.trim();
  if (!query) return;

  startTriageStream({
    type: 'text',
    text: query
  });
});

// ----------------------------------------------------
// Voice Recording Handler
// ----------------------------------------------------
const btnMic = document.getElementById('btn-mic');
const btnSendVoice = document.getElementById('btn-send-voice');
const recTimer = document.getElementById('rec-timer');
const voiceStatus = document.querySelector('.voice-status');

let mediaRecorder = null;
let audioChunks = [];
let recordInterval = null;
let recordStartTime = 0;
let audioBase64 = null;

// Audio Visualizer setup
const canvas = document.getElementById('waveform-visualizer');
const canvasCtx = canvas.getContext('2d');
let audioCtx = null;
let analyser = null;
let visualizerAnimation = null;

function setupVisualizer(stream) {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  const source = audioCtx.createMediaStreamSource(stream);
  source.connect(analyser);
  analyser.fftSize = 64;
  
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;

  function draw() {
    visualizerAnimation = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);

    canvasCtx.fillStyle = 'rgba(11, 15, 25, 0.4)';
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

    const barWidth = (canvas.width / bufferLength) * 1.5;
    let barHeight;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      barHeight = dataArray[i] / 2;
      
      // Teal gradient color
      canvasCtx.fillStyle = `rgb(20, ${Math.min(255, 100 + barHeight * 2)}, 166)`;
      canvasCtx.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight);
      
      x += barWidth;
    }
  }

  draw();
}

btnMic.addEventListener('click', async () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    // Stop Recording
    mediaRecorder.stop();
    btnMic.classList.remove('recording');
    voiceStatus.textContent = 'Recording complete. Review or upload below.';
    
    clearInterval(recordInterval);
    cancelAnimationFrame(visualizerAnimation);
    
    // Release mic stream
    mediaRecorder.stream.getTracks().forEach(track => track.stop());
  } else {
    // Start Recording
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Web Security Error: Microphone access is blocked over insecure HTTP connections. To use voice triage over WiFi, you must enable the "unsafely-treat-insecure-origin-as-secure" flag in chrome://flags and add http://' + window.location.host);
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      
      let options = {};
      if (MediaRecorder.isTypeSupported('audio/webm')) {
        options = { mimeType: 'audio/webm' };
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        options = { mimeType: 'audio/mp4' };
      }

      mediaRecorder = new MediaRecorder(stream, options);
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
        const playback = document.getElementById('audio-playback');
        playback.src = URL.createObjectURL(audioBlob);
        playback.style.display = 'block';

        // Convert Blob to base64
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          audioBase64 = reader.result;
          btnSendVoice.disabled = false;
        };
      };

      mediaRecorder.start();
      btnMic.classList.add('recording');
      voiceStatus.textContent = 'Listening... Speak your symptoms clearly.';
      btnSendVoice.disabled = true;

      // Timer
      recordStartTime = Date.now();
      recordInterval = setInterval(() => {
        const diff = Date.now() - recordStartTime;
        const secs = Math.floor(diff / 1000) % 60;
        const mins = Math.floor(diff / 60000);
        recTimer.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      }, 250);

      setupVisualizer(stream);

    } catch (err) {
      console.error('Mic access denied:', err);
      alert('Microphone access is required to use Voice triage.');
    }
  }
});

btnSendVoice.addEventListener('click', () => {
  if (!audioBase64) return;
  
  startTriageStream({
    type: 'voice',
    audio: audioBase64
  });
});

// ----------------------------------------------------
// Camera Viewfinder Handler
// ----------------------------------------------------
const viewfinder = document.getElementById('viewfinder');
const snapshotCanvas = document.getElementById('snapshot-canvas');
const snapshotPreview = document.getElementById('snapshot-preview');
const btnCapture = document.getElementById('btn-capture');
const btnRetake = document.getElementById('btn-retake');
const btnSendImage = document.getElementById('btn-send-image');
const imageQueryNote = document.getElementById('image-query-note');

let cameraStream = null;
let capturedImageBase64 = null;

async function startCamera() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Web Security Error: Camera access is blocked over insecure HTTP connections. To use camera triage over WiFi, you must enable the "unsafely-treat-insecure-origin-as-secure" flag in chrome://flags and add http://' + window.location.host);
      return;
    }
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false
    });
    viewfinder.srcObject = cameraStream;
    viewfinder.style.display = 'block';
    snapshotPreview.style.display = 'none';
    btnCapture.style.display = 'block';
    btnRetake.style.display = 'none';
    btnSendImage.disabled = true;
    capturedImageBase64 = null;
  } catch (err) {
    console.error('Camera access denied:', err);
    alert('Camera access is required to capture photos of skin symptoms.');
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
}

btnCapture.addEventListener('click', () => {
  if (!cameraStream) return;

  const width = viewfinder.videoWidth;
  const height = viewfinder.videoHeight;
  snapshotCanvas.width = width;
  snapshotCanvas.height = height;

  const ctx = snapshotCanvas.getContext('2d');
  ctx.drawImage(viewfinder, 0, 0, width, height);
  
  capturedImageBase64 = snapshotCanvas.toDataURL('image/jpeg');
  snapshotPreview.src = capturedImageBase64;
  
  // Toggle displays
  viewfinder.style.display = 'none';
  snapshotPreview.style.display = 'block';
  btnCapture.style.display = 'none';
  btnRetake.style.display = 'block';
  btnSendImage.disabled = false;
  
  stopCamera();
});

btnRetake.addEventListener('click', () => {
  startCamera();
});

btnSendImage.addEventListener('click', () => {
  if (!capturedImageBase64) return;

  startTriageStream({
    type: 'image',
    image: capturedImageBase64,
    text: imageQueryNote.value.trim()
  });
});
