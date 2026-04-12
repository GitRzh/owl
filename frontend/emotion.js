'use strict';

// ════════════════════════════════════════════════════
// FACE EMOTION + CAMERA
//
// Camera has two independent activation paths:
//   1. Manual toggle  — user clicks cam icon in left panel
//                       → shows feed, NO meter, cam stays on after
//   2. Smile challenge — triggered by chat or keyword
//       Case A: cam already ON  → show meter over existing feed,
//                                  cam stays on after challenge ends
//       Case B: cam was OFF     → start cam + meter, stop both after challenge
//
// Detection loop (setTimeout, not setInterval — avoids async pile-up):
//   - Runs whenever cameraStream is alive
//   - Always updates currentFaceScores (wired into every chat send)
//   - Smile threshold/hold logic only fires when smileActive === true
// ════════════════════════════════════════════════════

const camContainerEl = document.getElementById('cam-container');
const camVideoEl     = document.getElementById('cam-video');
const smileMeterEl   = document.getElementById('smile-meter');
const smileFillEl    = document.getElementById('smile-bar-fill');
const holdRingEl     = document.getElementById('hold-ring');
const camToggleBtn   = document.getElementById('cam-toggle-btn');

// ── Model loader ─────────────────────────────────────
async function loadFaceModels() {
  if (faceModelsLoaded) return true;
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('./models'),
      faceapi.nets.faceExpressionNet.loadFromUri('./models'),
    ]);
    faceModelsLoaded = true;
    return true;
  } catch (e) {
    console.error('[face-api] model load failed:', e);
    return false;
  }
}

// ── Low-level camera start / stop ────────────────────
async function startCam() {
  if (cameraStream) return true; // already running
  const ok = await loadFaceModels();
  if (!ok) return false;
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: 320, height: 240 },
    });
  } catch (e) {
    console.error('[cam] access denied:', e);
    return false;
  }
  camVideoEl.srcObject = cameraStream;
  await camVideoEl.play().catch(() => {});
  camContainerEl.classList.add('visible');
  _setCamBtnActive(true);
  // Kick off detection loop
  if (!detectIntervalId) {
    detectIntervalId = setTimeout(detectFrame, DETECT_MS);
  }
  return true;
}

function stopCam() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  // Clear pending detection timeout BEFORE nulling the id
  if (detectIntervalId) {
    clearTimeout(detectIntervalId);
    detectIntervalId = null;
  }
  camVideoEl.srcObject = null;
  camContainerEl.classList.remove('visible', 'smiling', 'challenge-mode');
  _setCamBtnActive(false);
  currentFaceScores = {};
  smileHoldStart    = null;
}

function _setCamBtnActive(on) {
  if (!camToggleBtn) return;
  camToggleBtn.classList.toggle('active', on);
}

// ── Manual camera toggle ─────────────────────────────
async function toggleManualCam() {
  // If a smile challenge is active — cancel it
  if (smileActive) {
    await cancelSmileChallenge();
    return;
  }
  if (manualCamOn) {
    manualCamOn = false;
    stopCam();
  } else {
    manualCamOn = true;
    await startCam();
  }
}

// ── Cancel smile challenge ────────────────────────────
async function cancelSmileChallenge() {
  smileActive = false;

  camContainerEl.classList.remove('smiling', 'challenge-mode');
  camContainerEl.classList.add('flicker-out');
  setTimeout(() => camContainerEl.classList.remove('flicker-out'), 1500);

  if (smileOpenedCam) {
    smileOpenedCam = false;
    manualCamOn    = false;
    setTimeout(() => stopCam(), 1500);
  }

  // Send a bail-out trigger — model replies casually
  // If already streaming (e.g. user cancelled mid-response), skip silently
  if (isStreaming) return;

  const cancelMsg = '[SMILE CHALLENGE CANCELLED]';
  chatHistory.push({ role: 'user', content: cancelMsg });
  messageCount++;
  isStreaming = true;
  setLocked(true);
  const stream = createStreamMsg();

  try {
    const resp = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: cancelMsg,
        history: chatHistory.slice(-10),
        stream:  true,
        summary: conversationSummary,
      }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      stream.append(decoder.decode(value, { stream: true }));
    }
    stream.finalize();
    chatHistory.push({ role: 'assistant', content: stream.content });
    messageCount++;
    addSquares(2);
  } catch (e) {
    stream.finalize();
    console.error('[smile-cancel]', e);
  }

  isStreaming = false;
  setLocked(false);
  userInputEl.focus();
}

// ── Smile challenge entry point ───────────────────────
async function startSmileChallenge() {
  if (smileActive) return;

  if (!cameraStream) {
    // Case B: cam was OFF — start it; close when done
    smileOpenedCam = true;
    const started = await startCam();
    if (!started) { smileOpenedCam = false; return; }
  } else {
    // Case A: cam was already ON — leave it running after challenge
    smileOpenedCam = false;
  }

  // Show meter
  camContainerEl.classList.add('challenge-mode');
  smileActive    = true;
  smileHoldStart = null;
  updateMeter(0);
  setHoldRing(0, 0);
}

// ── Detection loop (self-scheduling via setTimeout) ───
async function detectFrame() {
  if (!cameraStream) {
    detectIntervalId = null;
    return;
  }

  if (camVideoEl.videoWidth) {
    try {
      const det = await faceapi
        .detectSingleFace(
          camVideoEl,
          new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.40 }),
        )
        .withFaceExpressions();

      if (det) {
        // Always update live scores → wired into every chat message
        for (const [k, v] of Object.entries(det.expressions)) {
          currentFaceScores[k] = parseFloat(v.toFixed(3));
        }

        // Smile challenge logic only when active
        if (smileActive) {
          const happy = det.expressions.happy || 0;
          updateMeter(happy);

          if (happy >= SMILE_MIN) {
            camContainerEl.classList.add('smiling');
            if (!smileHoldStart) smileHoldStart = Date.now();
            const held     = Date.now() - smileHoldStart;
            const progress = Math.min(held / SMILE_HOLD_MS, 1);
            setHoldRing(happy, progress);

            if (held >= SMILE_HOLD_MS) {
              await onSmileComplete(det.expressions);
              if (cameraStream) detectIntervalId = setTimeout(detectFrame, DETECT_MS);
              return;
            }
          } else {
            camContainerEl.classList.remove('smiling');
            smileHoldStart = null;
            setHoldRing(0, 0);
          }
        }
      } else {
        currentFaceScores = {};
        if (smileActive) {
          updateMeter(0);
          camContainerEl.classList.remove('smiling');
          smileHoldStart = null;
          setHoldRing(0, 0);
        }
      }
    } catch (_) { /* skip frame */ }
  }

  if (cameraStream) {
    detectIntervalId = setTimeout(detectFrame, DETECT_MS);
  } else {
    detectIntervalId = null;
  }
}

// ── Meter UI helpers ─────────────────────────────────
function updateMeter(score) {
  smileFillEl.style.height = `${Math.round(score * 100)}%`;
  if (score > 0.50) {
    smileFillEl.style.background = 'var(--accent)';
    smileFillEl.style.boxShadow  = `0 0 ${Math.round(score * 12)}px var(--accent-glow)`;
  } else if (score > 0.25) {
    smileFillEl.style.background = '#4a4a4a';
    smileFillEl.style.boxShadow  = 'none';
  } else {
    smileFillEl.style.background = '#1e1e1e';
    smileFillEl.style.boxShadow  = 'none';
  }
}

function setHoldRing(smileScore, progress) {
  if (progress <= 0) { holdRingEl.style.opacity = '0'; return; }
  holdRingEl.style.opacity    = '1';
  holdRingEl.style.bottom     = `${Math.round(smileScore * 100)}%`;
  holdRingEl.style.background = progress >= 0.75 ? 'var(--accent)' : 'rgba(255,255,255,0.65)';
}

// ── Smile complete ────────────────────────────────────
async function onSmileComplete(expressions) {
  smileActive = false;

  camContainerEl.classList.remove('smiling', 'challenge-mode');
  camContainerEl.classList.add('flicker-out');
  setTimeout(() => camContainerEl.classList.remove('flicker-out'), 1500);

  if (smileOpenedCam) {
    // Challenge opened the cam — shut it after flicker
    smileOpenedCam = false;
    manualCamOn    = false;
    setTimeout(() => stopCam(), 1500);
  }
  // else cam stays alive (was manually on)

  // Build face scores snapshot
  const faceScores = {};
  for (const [k, v] of Object.entries(expressions)) {
    faceScores[k] = parseFloat(v.toFixed(3));
  }

  const triggerMsg = '[SMILE DETECTED]';
  chatHistory.push({ role: 'user', content: triggerMsg });
  messageCount++;

  isStreaming = true;
  setLocked(true);
  const stream = createStreamMsg();

  try {
    const resp = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message:     triggerMsg,
        history:     chatHistory.slice(-10),
        stream:      true,
        summary:     conversationSummary,
        face_scores: faceScores,
      }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      stream.append(decoder.decode(value, { stream: true }));
    }
    stream.finalize();
    chatHistory.push({ role: 'assistant', content: stream.content });
    messageCount++;
    addSquares(3);

    // Mirror summarisation trigger from sendMessage
    if (chatHistory.length >= 20 && chatHistory.length % 10 === 0) {
      try {
        const r = await fetch(`${API_BASE}/summarize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ history: chatHistory }),
        });
        const d = await r.json();
        if (d.summary) conversationSummary = d.summary;
      } catch (_) { /* silent */ }
    }
  } catch (e) {
    stream.finalize();
    console.error('[smile-complete]', e);
  }

  isStreaming = false;
  setLocked(false);
  userInputEl.focus();
}

// ── Cam toggle button wiring ──────────────────────────
if (camToggleBtn) {
  camToggleBtn.addEventListener('click', toggleManualCam);
}