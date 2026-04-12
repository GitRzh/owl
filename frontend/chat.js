'use strict';

// ════════════════════════════════════════════════════
// MESSAGES UI
// ════════════════════════════════════════════════════
const messagesEl = document.getElementById('messages');
const emptyEl    = document.getElementById('empty-state');
let emptyRemoved = false;

function removeEmpty() {
  if (!emptyRemoved && emptyEl && emptyEl.parentNode) {
    emptyEl.remove();
    emptyRemoved = true;
  }
}

function scrollBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// msgIndex tracks insertion order for 60ms stagger
let msgIndex = 0;

function buildMsgEl(role) {
  removeEmpty();

  const wrap = document.createElement('div');
  wrap.className = `msg ${role === 'user' ? 'user' : 'assistant'}`;
  // 60ms stagger per message
  wrap.style.animationDelay = `${msgIndex * 60}ms`;
  msgIndex++;

  if (role === 'user') {
    // "you" label
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.textContent = 'you';
    wrap.appendChild(meta);
  } else {
    // three animated dots instead of "owl" label
    const dots = document.createElement('div');
    dots.className = 'owl-dots';
    dots.innerHTML = '<span></span><span></span><span></span>';
    wrap.appendChild(dots);
  }

  const textEl = document.createElement('div');
  textEl.className = 'msg-text';
  wrap.appendChild(textEl);
  messagesEl.appendChild(wrap);
  // Scroll immediately when assistant bubble appears (even before first token)
  if (role !== 'user') scrollBottom();
  return { wrap, textEl };
}

function addUserMessage(text) {
  const { textEl } = buildMsgEl('user');
  textEl.textContent = text;
  scrollBottom();
}

function addTTSButton(wrap, text) {
  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  const btn = document.createElement('button');
  btn.className = 'tts-btn';
  // Speaker icon SVG — changes to stop square when playing
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill="currentColor" stroke="none" opacity="0.8"/>
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
  </svg>`;
  btn.setAttribute('title', 'play');
  btn.addEventListener('click', () => playTTS(text, btn));
  actions.appendChild(btn);
  wrap.appendChild(actions);
}

const TYPING_MS = 22; // ms per character

function createStreamMsg() {
  const { wrap, textEl } = buildMsgEl('assistant');
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  textEl.appendChild(cursor);

  let content   = '';
  let displayed = '';
  let typeQueue = '';
  let typing    = false;

  function drainQueue() {
    if (!typeQueue.length) { typing = false; return; }
    const ch  = typeQueue[0];
    typeQueue = typeQueue.slice(1);
    displayed += ch;
    content   = displayed + typeQueue;
    textEl.textContent = displayed;
    textEl.appendChild(cursor);
    scrollBottom();
    setTimeout(drainQueue, TYPING_MS);
  }

  return {
    get content() { return content; },
    append(chunk) {
      content   += chunk;
      typeQueue += chunk;
      if (!typing) { typing = true; drainQueue(); }
    },
    finalize() {
      const finish = () => {
        if (typeQueue.length) { setTimeout(finish, TYPING_MS); return; }
        cursor.remove();
        textEl.textContent = content;
        if (content.trim()) addTTSButton(wrap, content);
        scrollBottom();
      };
      finish();
    }
  };
}

// ════════════════════════════════════════════════════
// MOOD TRACKING
// ════════════════════════════════════════════════════

function pushMoodScore(score) {
  if (score < 0) return; // -1 sentinel = internal trigger, skip
  moodScores.push(score);
  if (moodScores.length > MOOD_WINDOW) moodScores.shift();
}

function weightedMoodAvg() {
  const len = moodScores.length;
  if (len === 0) return 0;
  const weights = MOOD_WEIGHTS.slice(MOOD_WEIGHTS.length - len);
  const sum     = moodScores.reduce((acc, s, i) => acc + s * weights[i], 0);
  const wSum    = weights.reduce((a, b) => a + b, 0);
  return sum / wSum;
}

function shouldNudge() {
  if (messageCount < MOOD_MIN_TURNS * 2) return false;
  if (smileActive) return false;
  const cooldown = smileCancelled ? MOOD_REJECT_COOL : MOOD_COOLDOWN;
  if (messageCount - lastNudgeAt < cooldown * 2) return false;
  if (moodScores.length < MOOD_WINDOW) return false;
  return weightedMoodAvg() >= MOOD_THRESHOLD;
}

async function sendNudge() {
  lastNudgeAt    = messageCount;
  smileCancelled = false;

  const nudgeMsg = '[SMILE CHALLENGE NUDGE]';
  chatHistory.push({ role: 'user', content: nudgeMsg });
  messageCount++;
  isStreaming = true;
  setLocked(true);
  const stream = createStreamMsg();

  try {
    const resp = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message:     nudgeMsg,
        history:     chatHistory.slice(-10),
        stream:      true,
        summary:     conversationSummary,
        face_scores: Object.keys(currentFaceScores).length ? currentFaceScores : undefined,
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
    addSquares(1);

    if (SMILE_RESP_PATS.some(p => p.test(stream.content))) {
      setTimeout(startSmileChallenge, 700);
    }
  } catch (e) {
    stream.finalize();
    console.error('[nudge]', e);
  }

  isStreaming = false;
  setLocked(false);
  userInputEl.focus();
}

// ════════════════════════════════════════════════════
// SEND MESSAGE
// ════════════════════════════════════════════════════
const userInputEl = document.getElementById('user-input');
const sendBtnEl   = document.getElementById('send-btn');

const SMILE_USER_PATS = [
  /smile\s*challenge/i, /make me smile/i,
  /smile\s*meter/i, /cheer me up game/i,
];
const SMILE_RESP_PATS = [
  /give me a real (one|smile)/i,
  /real smile[.,!]?\s*go/i,
  /let[''']?s see it/i,
  /alright[.,]?\s*(real\s*)?smile/i,
  /okay[.,]?\s*(real\s*)?smile/i,
  /real smile\s*[.,!]/i,
];

function autoResize() {
  userInputEl.style.height = 'auto';
  userInputEl.style.height = Math.min(userInputEl.scrollHeight, 96) + 'px';
}
userInputEl.addEventListener('input', autoResize);

userInputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitInput(); }
});
sendBtnEl.addEventListener('click', submitInput);

function flashSubmit() {
  // accent flash on input + arrow nudge
  userInputEl.classList.add('flash');
  sendBtnEl.classList.add('fired');
  setTimeout(() => userInputEl.classList.remove('flash'), 320);
  setTimeout(() => sendBtnEl.classList.remove('fired'), 280);
}

function submitInput() {
  const text = userInputEl.value.trim();
  if (!text || isStreaming) return;
  flashSubmit();
  userInputEl.value = '';
  autoResize();
  sendMessage(text);
}

function setLocked(val) {
  userInputEl.disabled = val;
  sendBtnEl.disabled   = val;
}

async function sendMessage(text, hidden = false) {
  if (isStreaming) return;
  isStreaming = true;
  setLocked(true);

  if (text === '[SMILE CHALLENGE CANCELLED]') smileCancelled = true;

  if (!hidden) addUserMessage(text);
  chatHistory.push({ role: 'user', content: text });
  messageCount++;
  addSquares(Math.floor(Math.random() * 2) + 1);

  if (!smileActive && SMILE_USER_PATS.some(p => p.test(text))) {
    startSmileChallenge();
  }

  // summarize old history
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

  const stream = createStreamMsg();

  // Slight human-like pause before model starts typing
  await new Promise(r => setTimeout(r, 600 + Math.random() * 400));

  try {
    const resp = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        history: chatHistory.slice(-10),
        stream: true,
        summary: conversationSummary,
        face_scores: Object.keys(currentFaceScores).length ? currentFaceScores : undefined,
      }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    // Read mood score — no extra API call, computed server-side for free
    const moodScore = parseFloat(resp.headers.get('X-Mood-Score') ?? '-1');
    pushMoodScore(moodScore);

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
    addSquares(1);

    if (!smileActive && SMILE_RESP_PATS.some(p => p.test(stream.content))) {
      setTimeout(startSmileChallenge, 700);
    }

    // Nudge check — fires after model replies, never interrupts
    if (shouldNudge()) setTimeout(sendNudge, 1200);

  } catch (e) {
    stream.finalize();
    console.error('[chat]', e);
  }

  isStreaming = false;
  setLocked(false);
  userInputEl.focus();
}