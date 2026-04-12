# OWL — On-call Wise Listener

> A local mental wellness companion that listens, responds with warmth, and reads how you're actually doing — through your words, your voice, and your face.

---

## What it does

You open OWL and start talking. No profile, no setup. It reads what you type or say, picks up on your facial expression if the camera is on, and responds like something that genuinely pays attention.

The language model is backed by a set of clinical mental health documents, so its responses have some grounding. It tracks the emotional weight of your messages over time. If things stay heavy, it may suggest a smile challenge — a camera-based moment where you hold a real smile for three seconds. Low-stakes, optional, skippable.

**What it can do:**
- Hold a flowing, context-aware conversation using a RAG-backed LLM
- Route heavier or escalated messages to a larger model automatically
- Detect your facial expressions in real time via face-api.js (runs entirely in the browser)
- Score the emotional weight of your messages server-side and gently nudge toward a smile challenge when needed
- Speak responses aloud in a male or female voice via Edge TTS
- Transcribe voice input using Whisper (Groq-hosted)
- Summarize long conversations automatically to stay within context limits
- Block jailbreak attempts using regex and semantic similarity detection

---

## Tech Stack

| Layer | Tools |
|---|---|
| Backend | Python, FastAPI, Uvicorn |
| Language models | Groq API — `llama-3.1-8b-instant` (default), `llama-3.3-70b-versatile` (escalated messages) |
| RAG pipeline | LangChain, ChromaDB, HuggingFace Embeddings (`all-MiniLM-L6-v2`) |
| Document loader | PyPDF (LangChain) |
| Face detection | face-api.js (`TinyFaceDetector` + `FaceExpressionNet`) |
| TTS | edge-tts (`en-US-JennyNeural`, `en-US-BrianNeural`) |
| STT | Groq Whisper (`whisper-large-v3-turbo`) |
| Jailbreak detection | Cosine similarity via HuggingFace embeddings |
| Frontend | Vanilla HTML / CSS / JS |

---

## File Structure

```
OWL/
│
├── backend/
│   ├── main.py              # FastAPI app — /chat, /tts, /transcribe, /summarize
│   ├── chat.py              # Prompt building, streaming, mood scoring, model routing
│   ├── rag.py               # PDF ingestion, embedding, ChromaDB retrieval
│   ├── emotion.py           # Face score parsing, dominant + secondary emotion extraction
│   ├── jailbreak.py         # Semantic jailbreak detection
│   └── docs/                # Clinical PDFs indexed by RAG
│       ├── qpr_guide.pdf
│       ├── samhsa_crisis_guidelines.pdf
│       ├── nih_prolonged_grief.pdf
│       ├── nih_complicated_grief.pdf
│       ├── nih_anger_aggression.pdf
│       ├── nih_anger_treatment.pdf
│       ├── nih_stress_coping.pdf
│       └── nih_loneliness_isolation.pdf
│
├── frontend/
│   ├── index.html
│   ├── style.css
│   ├── app.js               # Global state, config, background animations
│   ├── chat.js              # Message rendering, streaming, send logic
│   ├── emotion.js           # Camera lifecycle, face detection, smile challenge
│   ├── tts-stt.js           # TTS playback, mic recording
│   ├── face-api.min.js      # Bundled face-api.js
│   └── models/              # Pre-trained face model weights (bundled)
│
└── requirements.txt
```

---

## Setup

**Prerequisites:** Python 3.10 or 3.11, and a Groq API key from [console.groq.com](https://console.groq.com).

**1. Clone and enter the repo**
```bash
git clone https://github.com/GitRzh/owl.git
cd owl
```

**2. Create a virtual environment**
```bash
python -m venv venv
source venv/bin/activate       # Mac / Linux
venv\Scripts\activate          # Windows
```

**3. Install dependencies**
```bash
pip install -r requirements.txt
```

**4. Add your API key**

Create `backend/.env`:
```
GROQ_API_KEY=your_key_here
```

**5. Run the backend**
```bash
cd backend
python main.py
```

First run builds embeddings from the PDFs in `docs/` — saved to `backend/embeddings/` and skipped on every run after.

**6. Open the frontend**

Serve `frontend/` with any static server:
```bash
cd frontend
python -m http.server 5500
```
Then open `http://localhost:5500`. Opening `index.html` via `file://` will block camera and mic access.

---

## RAG Document Sources

Clinical grounding for OWL's responses is drawn from publicly available materials:

- **QPR Gatekeeper Training Guide** — QPR Institute. Suicide risk recognition and intervention for non-clinical settings.
- **SAMHSA Crisis Guidelines** — Substance Abuse and Mental Health Services Administration. Evidence-based behavioral health crisis response protocols.
- **NIH: Prolonged Grief** — NIMH. Clinical overview of prolonged grief disorder and treatment pathways.
- **NIH: Complicated Grief** — NIH. Research on complicated grief and its distinction from standard bereavement.
- **NIH: Anger and Aggression** — NIH. Anger dysregulation, contributing factors, and intervention approaches.
- **NIH: Anger Treatment** — NIH. Evidence-based anger management and therapy approaches.
- **NIH: Stress and Coping** — NIMH. Stress recognition and healthy coping strategies.
- **NIH: Loneliness and Isolation** — NIH. Health impacts of social isolation and approaches to connection.

Used solely for retrieval-augmented generation. No content is redistributed.

---

## Face Detection Credits

Face detection and expression recognition run entirely in your browser:

- **face-api.js** by Vincent Mühler — [github.com/justadudewhohacks/face-api.js](https://github.com/justadudewhohacks/face-api.js) (MIT License)
- **TinyFaceDetector** — lightweight real-time face detection model, bundled with face-api.js
- **FaceExpressionNet** — MobileNet-based expression classifier trained on AffectNet and FER+, bundled with face-api.js

No face data or expression scores leave your device.

---

## Caution

- OWL is not a crisis service. If you or someone you know is in immediate danger, contact emergency services or a crisis line in your region.
- Your conversations are not stored or transmitted. Everything clears when you close the tab. Do not commit your `.env` key to version control.
- The language model can produce incorrect or unhelpful responses, especially during escalated moments. It is not a substitute for a trained professional.
- Emotion detection is probabilistic — a misread face will affect the tone of a response.
- If `docs/` is empty, OWL still runs but without any clinical grounding.

---

*A real person who knows you will always reach you in ways a program simply cannot.*
