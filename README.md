# OWL — On-call Wise Listener

> A local mental wellness companion that listens, responds with warmth, and gently nudges you toward a smile — powered by a RAG-backed language model, real-time face emotion detection, and voice I/O.

---

## What it does

You open OWL and start talking. That's it. There's no form to fill out, no profile to create. OWL reads what you type (or say), reads your face if you let it, and responds like something that genuinely cares about how you're doing.

Behind that simplicity is a layered system. The language model pulls from a curated set of clinical mental health documents to ground its responses in real guidance. It watches the emotional weight of your messages over time and, when it senses a sustained low mood, quietly introduces a smile challenge — a small, optional moment of levity that asks you to hold a real smile for three seconds. No pressure. You can skip it.

**What it can do:**
- Hold a flowing, context-aware conversation using a RAG-backed LLM (Groq / Llama)
- Detect your facial emotions in real time using face-api.js (runs fully in the browser)
- Score the emotional weight of your messages server-side and nudge toward positivity when needed
- Run a smile challenge: camera-based, hold-to-confirm, with a live meter
- Speak its responses aloud in a male or female voice via Edge TTS
- Transcribe your voice input using Whisper (Groq-hosted)
- Summarize long conversations automatically to stay within context limits
- Block jailbreak attempts using both regex and semantic similarity detection

---

## Tech Stack

| Layer | Tools |
|---|---|
| Backend | Python, FastAPI, Uvicorn |
| Language model | Groq API (Llama 3.3 70B) |
| RAG pipeline | LangChain, ChromaDB, HuggingFace Embeddings (`all-MiniLM-L6-v2`) |
| Document loader | PyPDF (LangChain) |
| Face detection | face-api.js (`TinyFaceDetector` + `FaceExpressionNet`) |
| TTS | edge-tts (`en-US-JennyNeural`, `en-US-BrianNeural`) |
| STT | Groq Whisper (`whisper-large-v3-turbo`) |
| Jailbreak detection | Semantic cosine similarity via HuggingFace embeddings |
| Frontend | Vanilla HTML / CSS / JS |

---

## File Structure

```
OWL/
│
├── backend/
│   ├── main.py              # FastAPI app — all routes (/chat, /tts, /transcribe, /summarize)
│   ├── chat.py              # Prompt building, streaming response, mood scoring
│   ├── rag.py               # Document ingestion, embedding, ChromaDB retrieval
│   ├── emotion.py           # Face score parsing, dominant + secondary emotion extraction
│   ├── jailbreak.py         # Semantic jailbreak detection using pre-computed intent embeddings
│   └── docs/                # Clinical PDFs indexed by RAG (see Sources below)
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
│   ├── index.html           # Full UI — landing + chat page
│   ├── style.css            # All styles (dark theme, animations, smile meter)
│   ├── app.js               # Global state, config, dot wave background, block transition
│   ├── chat.js              # Message rendering, streaming, mood tracking, send logic
│   ├── emotion.js           # Camera lifecycle, face detection loop, smile challenge flow
│   ├── tts-stt.js           # TTS playback and mic recording
│   ├── face-api.min.js      # Bundled face-api.js library
│   └── models/              # Pre-trained face detection model weights
│       ├── tiny_face_detector_model-shard1
│       ├── tiny_face_detector_model-weights_manifest.json
│       ├── face_expression_model-shard1
│       └── face_expression_model-weights_manifest.json
│
├── requirements.txt
└── README.md
```

---

## Setup

**0. Prerequisites**

- Python 3.10 or 3.11 (recommended)
- Node is not required — the frontend is plain HTML/JS
- A Groq API key — get one free at [console.groq.com](https://console.groq.com)

**1. Clone the repo**
```bash
git clone https://github.com/GitRzh/owl.git
cd owl
```

**2. Create and activate a virtual environment**
```bash
python -m venv venv

# Windows
venv\Scripts\activate

# Mac / Linux
source venv/bin/activate
```

**3. Install dependencies**
```bash
pip install -r requirements.txt
```

On slower machines, the torch CPU wheel can take a few minutes. That's normal.

**4. Add your API key**

Create a `.env` file in the `backend/` folder:
```
GROQ_API_KEY=your_key_here
```

**5. Run the backend**
```bash
cd backend
python main.py
```

On first run, OWL will build embeddings from the PDFs in `docs/` and save them to `backend/embeddings/`. This only happens once — subsequent starts load from disk.

**6. Open the frontend**

Open `frontend/index.html` directly in your browser. No server needed for the frontend.

If the camera or mic don't respond, make sure you're opening the file over `http://` (use a local server like `python -m http.server 5500` inside `frontend/`) rather than `file://`, since browsers restrict camera access on `file://` origins.

---

## How the Smile Challenge works

OWL tracks a rolling weighted average of the emotional weight of your messages (scored server-side, no extra API calls). After enough turns, if your mood score stays below a threshold, OWL gently suggests the smile challenge.

When it fires:
1. Your camera turns on (with your permission)
2. A vertical smile meter appears alongside the feed
3. OWL asks you to give it a real smile
4. Hold the smile above the threshold for 3 seconds — the ring fills as you hold it
5. On success, OWL responds to what it saw in your face

You can cancel at any time by clicking the camera icon. OWL won't push it again for a while.

---

## RAG Document Sources

The clinical knowledge base powering OWL's responses is drawn from publicly available mental health materials:

- **QPR Gatekeeper Training Guide** — QPR Institute. Suicide risk recognition and intervention techniques for non-clinical settings.
- **SAMHSA Crisis Guidelines** — Substance Abuse and Mental Health Services Administration. Evidence-based protocols for behavioral health crisis response.
- **NIH: Prolonged Grief** — National Institute of Mental Health (NIMH). Clinical overview of prolonged grief disorder, symptoms, and treatment pathways.
- **NIH: Complicated Grief** — National Institutes of Health. Research summary on complicated grief and its distinction from standard bereavement.
- **NIH: Anger and Aggression** — National Institutes of Health. Overview of anger dysregulation, contributing factors, and intervention approaches.
- **NIH: Anger Treatment** — National Institutes of Health. Evidence-based approaches to anger management and therapy.
- **NIH: Stress and Coping** — National Institute of Mental Health (NIMH). Guidance on stress recognition and healthy coping strategies.
- **NIH: Loneliness and Isolation** — National Institutes of Health. Research on the health impacts of social isolation and approaches to connection.

These documents are used solely for retrieval-augmented generation. OWL does not reproduce or redistribute their content.

---

## Face Detection Credits

Face detection and expression recognition run entirely in the browser using:

- **face-api.js** by Vincent Mühler — [github.com/justadudewhohacks/face-api.js](https://github.com/justadudewhohacks/face-api.js) (MIT License)
- **TinyFaceDetector model** — a lightweight face detection architecture trained for real-time browser inference, bundled with face-api.js
- **FaceExpressionNet model** — a MobileNet-based expression classifier trained on AffectNet and FER+, bundled with face-api.js

No face data, images, or expression scores leave your device. Detection runs locally on every frame.

---

## Notes

- OWL does not store your chat history between sessions. Everything lives in memory and clears when you close the tab.
- The `.env` file is in `.gitignore` by default — don't commit your API key.
- If RAG returns no results (empty `docs/` folder), OWL still works — it just won't have clinical grounding for its responses.
- The jailbreak detector reuses the same embeddings model loaded for RAG, so there's no extra model download.

---

## Warning

OWL is a personal project, not a clinical tool. It does not assess risk, provide diagnoses, or replace professional support in any form. The language model can be wrong. The emotion detection can be wrong. Treat everything it says as a starting point for reflection, not as advice.

---

*A real person who knows you will always reach you in ways a program simply cannot.*
