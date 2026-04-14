'use strict';

// ════════════════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════════════════
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:8000'
  : 'https://rzhface-owl.hf.space';
const SMILE_MIN     = 0.62;
const SMILE_HOLD_MS = 3000;
const DETECT_MS     = 180;

// ════════════════════════════════════════════════════
// SHARED STATE
// ════════════════════════════════════════════════════
let selectedGender      = 'female';
let chatHistory         = [];
let conversationSummary = '';
let messageCount        = 0;
let isStreaming          = false;

let isRecording   = false;
let mediaRecorder = null;
let audioChunks   = [];
let activeAudio   = null;

let smileActive      = false;
let smileHoldStart   = null;
let detectIntervalId = null;
let cameraStream     = null;
let faceModelsLoaded = false;

// Camera mode flags
let manualCamOn    = false;  // user manually toggled cam
let smileOpenedCam = false;  // smile challenge opened cam (must close after)

// Live face scores — updated every detection frame, sent with every chat message
let currentFaceScores = {};

// ── Mood tracking (for smile nudge) ──────────────────
// Weighted rolling window of mood scores from backend.
// Weights are applied oldest→newest so recent turns count more.
const MOOD_WEIGHTS      = [1, 1.5, 2, 2.5, 3, 3.5]; // matches window size 6
const MOOD_WINDOW       = MOOD_WEIGHTS.length;
const MOOD_THRESHOLD    = 0.30;  // weighted avg above this → consider nudge
const MOOD_MIN_TURNS    = 5;     // don't nudge before at least 5 real turns
const MOOD_COOLDOWN     = 10;    // turns to wait before nudging again
const MOOD_REJECT_COOL  = 20;    // extended cooldown after user rejects

let moodScores       = [];   // rolling array of raw scores (max MOOD_WINDOW)
let lastNudgeAt      = -999; // messageCount value when last nudge was sent
let smileCancelled   = false; // true if user cancelled the last challenge

// ════════════════════════════════════════════════════
// OS DETECTION + CLOCK
// ════════════════════════════════════════════════════
function detectOS() {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua))      return 'android';
  if (/iPhone|iPad/i.test(ua))  return 'ios';
  if (/Windows/i.test(ua))      return 'windows';
  if (/Mac/i.test(ua))          return 'macos';
  if (/Linux/i.test(ua))        return 'linux';
  return 'unknown';
}

(function initClock() {
  const landingTimeEl = document.getElementById('landing-time');
  const landingOsEl   = document.getElementById('landing-os');
  const chatTimeEl    = document.getElementById('topbar-clock');

  if (landingOsEl) landingOsEl.textContent = detectOS();

  function tick() {
    const t = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (landingTimeEl) landingTimeEl.textContent = t;
    if (chatTimeEl)    chatTimeEl.textContent    = t;
  }
  tick();
  setInterval(tick, 1000);
})();


// ════════════════════════════════════════════════════
(function initDotWave() {
  const canvas = document.getElementById('dot-canvas');
  const ctx    = canvas.getContext('2d');
  let W, H, cols, rows, t = 0;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
    cols = Math.ceil(W / 26) + 1;
    rows = Math.ceil(H / 26) + 1;
  }
  resize();
  window.addEventListener('resize', resize);

  function draw() {
    ctx.clearRect(0, 0, W, H);
    t += 0.018;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x  = col * 26;
        const y  = row * 26;
        const w1 = Math.sin(t + col * 0.38 + row * 0.18);
        const w2 = Math.sin(t * 0.7 - col * 0.28 + row * 0.32);
        const a  = ((w1 + w2) / 2 + 1) / 2;
        ctx.beginPath();
        ctx.arc(x, y, 0.8 + a * 0.9, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(244,169,127,${(0.04 + a * 0.18).toFixed(3)})`;
        ctx.fill();
      }
    }
    requestAnimationFrame(draw);
  }
  draw();
})();

// ════════════════════════════════════════════════════
// SOLID BORDER BARS — landing gets 4 full-side bars,
// chat gets 4 corner L-brackets
// ════════════════════════════════════════════════════
(function injectBars() {
  ['bar-top','bar-bottom','bar-left','bar-right'].forEach(id => {
    const el = document.createElement('div');
    el.id = id;
    el.className = 'border-bar';
    document.body.appendChild(el);
  });
})();



// ════════════════════════════════════════════════════
// BLOCK TRANSITION
// Fixed grid of squares, each appearing at a random
// time until the screen is fully covered.
// ════════════════════════════════════════════════════
function runBlockTransition(onCovered) {
  const overlay = document.getElementById('block-overlay');
  overlay.style.pointerEvents = 'all';

  const bw   = 80, bh = 80;
  const cols = Math.ceil(window.innerWidth  / bw) + 1;
  const rows = Math.ceil(window.innerHeight / bh) + 1;

  const APPEAR_MS = 220;

  // Build all grid positions then shuffle
  const positions = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      positions.push({ c, r });

  // Fisher-Yates shuffle
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }

  positions.forEach(({ c, r }, i) => {
    const blk = document.createElement('div');
    blk.className = 'blk';
    blk.style.cssText = `left:${c*bw}px;top:${r*bh}px;width:${bw+1}px;height:${bh+1}px;background:rgba(18,40,90,0.88);opacity:0;`;
    overlay.appendChild(blk);
    setTimeout(() => {
      requestAnimationFrame(() => { blk.style.opacity = '1'; });
    }, Math.random() * APPEAR_MS);
  });

  setTimeout(() => {
    onCovered();
    setTimeout(() => {
      // Fade out in random order too
      const blks = Array.from(overlay.querySelectorAll('.blk'));
      blks.sort(() => Math.random() - 0.5);
      blks.forEach((blk, i) => setTimeout(() => { blk.style.opacity = '0'; }, i * 0.8));
      setTimeout(() => {
        overlay.innerHTML = '';
        overlay.style.pointerEvents = 'none';
      }, blks.length * 0.8 + 150);
    }, 60);
  }, APPEAR_MS + 80);
}

// ════════════════════════════════════════════════════
// LANDING → CHAT
// ════════════════════════════════════════════════════
const landingEl  = document.getElementById('landing');
const chatPageEl = document.getElementById('chat-page');

document.getElementById('begin-btn').addEventListener('click', () => {
  runBlockTransition(() => {
    landingEl.style.display = 'none';
    document.getElementById('landing-info').style.display = 'none';
    chatPageEl.style.display = 'flex';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      chatPageEl.classList.add('active');
    }));
    document.getElementById('user-input').focus();
    addSquares(10);
  });
});

// ════════════════════════════════════════════════════
// GENDER TOGGLE
// ════════════════════════════════════════════════════
document.querySelectorAll('.g-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.g-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedGender = btn.dataset.g;
  });
});

// ════════════════════════════════════════════════════
// MEMORY SQUARES
// ════════════════════════════════════════════════════
const leftPanel  = document.getElementById('left-panel');
const rightPanel = document.getElementById('right-panel');

function spawnSquare() {
  const panels = [leftPanel, rightPanel];
  const panel  = panels[Math.floor(Math.random() * 2)];
  const pr     = panel.getBoundingClientRect();
  if (!pr.width) return;

  const size   = Math.floor(Math.random() * 14) + 3;
  const x      = Math.floor(Math.random() * Math.max(1, pr.width  - size));
  const y      = Math.floor(Math.random() * Math.max(1, pr.height - size));
  const isLime = Math.random() > 0.68;
  const baseO  = parseFloat((Math.random() * 0.32 + 0.05).toFixed(2));

  const sq = document.createElement('div');
  sq.className = 'mem-sq';
  sq.style.cssText = `width:${size}px;height:${size}px;left:${x}px;top:${y}px;background:${isLime ? 'var(--accent)' : 'rgba(20,35,70,0.55)'};opacity:0;transition:opacity 0.5s;`;
  panel.appendChild(sq);

  requestAnimationFrame(() => requestAnimationFrame(() => { sq.style.opacity = baseO.toString(); }));
  setTimeout(() => startFlicker(sq, baseO), 800 + Math.random() * 2000);
}

function startFlicker(el, baseO) {
  const tick = () => {
    const r = Math.random();
    const o = r < 0.07 ? 0 : r < 0.22 ? baseO * 0.2 : r < 0.45 ? baseO * 0.6 : baseO;
    el.style.opacity = o.toString();
    setTimeout(tick, 60 + Math.random() * 1100);
  };
  tick();
}

function addSquares(n = 2) {
  for (let i = 0; i < n; i++) spawnSquare();
}
