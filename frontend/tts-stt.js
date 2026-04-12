'use strict';

// ════════════════════════════════════════════════════
// TTS (Text-to-Speech)
// ════════════════════════════════════════════════════
const SPEAKER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill="currentColor" stroke="none" opacity="0.8"/>
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
  </svg>`;
const STOP_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" style="color:var(--accent)">
    <rect x="5" y="5" width="14" height="14" rx="1"/>
  </svg>`;
const DOTS_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" style="opacity:0.5">
    <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
  </svg>`;

async function playTTS(text, btn) {
  if (btn.disabled) return; // guard double-click during loading
  if (activeAudio) {
    activeAudio.pause();
    activeAudio = null;
    document.querySelectorAll('.tts-btn').forEach(b => {
      b.innerHTML = SPEAKER_SVG;
      b.disabled  = false;
      b.style.color = '';
    });
    if (btn.querySelector('rect')) return; // was a stop btn, so just stop
  }

  btn.innerHTML  = DOTS_SVG;
  btn.disabled   = true;

  try {
    const resp = await fetch(`${API_BASE}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, gender: selectedGender }),
    });
    if (!resp.ok) throw new Error('TTS failed');

    const blob = await resp.blob();
    const url  = URL.createObjectURL(blob);
    activeAudio = new Audio(url);

    btn.innerHTML = STOP_SVG;
    btn.style.color = 'var(--accent)';
    btn.disabled  = false;
    activeAudio.play();

    activeAudio.onended = () => {
      btn.innerHTML = SPEAKER_SVG;
      btn.style.color = '';
      btn.disabled  = false;
      activeAudio   = null;
      URL.revokeObjectURL(url);
    };

  } catch (e) {
    btn.innerHTML = SPEAKER_SVG;
    btn.style.color = '';
    btn.disabled  = false;
    console.error('[tts]', e);
  }
}

// ════════════════════════════════════════════════════
// VOICE RECORDING (STT)
// mic-btn now uses icon only — no label span
// ════════════════════════════════════════════════════
const micBtnEl = document.getElementById('mic-btn');

micBtnEl.addEventListener('click', () => {
  if (isRecording) stopRecording();
  else startRecording();
});

async function startRecording() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    console.error('[mic] access denied:', e);
    return;
  }

  audioChunks = [];
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/webm')
    ? 'audio/webm'
    : 'audio/ogg';

  mediaRecorder = new MediaRecorder(stream, { mimeType });

  mediaRecorder.ondataavailable = e => {
    if (e.data.size > 0) audioChunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    micBtnEl.classList.remove('recording');
    stream.getTracks().forEach(t => t.stop());

    const blob     = new Blob(audioChunks, { type: mimeType });
    const formData = new FormData();
    formData.append('audio', blob, 'voice.webm');

    try {
      const resp = await fetch(`${API_BASE}/transcribe`, {
        method: 'POST', body: formData,
      });
      const data = await resp.json();
      if (data.transcript && data.transcript.trim()) {
        const transcript = data.transcript.trim();
        userInputEl.value = transcript;
        autoResize();
        userInputEl.focus();
      }
    } catch (e) {
      console.error('[stt]', e);
    }
  };

  mediaRecorder.start(250);
  isRecording = true;
  micBtnEl.classList.add('recording');
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  isRecording = false;
}