from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
from chat import build_response, build_response_stream, summarize_history, score_message_weight
from rag import init_rag, retrieve_context
from emotion import merge_emotions, parse_face_emotion_rich
from jailbreak import init_jailbreak_detector, is_jailbreak
from dotenv import load_dotenv
from groq import Groq
import uvicorn, os, io, re, asyncio, random

load_dotenv()

# ── Clients ───────────────────────────────────────────────
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# ── Edge TTS voice map ────────────────────────────────────
EDGE_VOICES = {
    "female": "en-US-JennyNeural",
    "male":   "en-US-BrianNeural",
}

# ── Input sanitization ────────────────────────────────────
BLOCKED_PATTERNS = [
    r"ignore (all |previous |your )?instructions",
    r"you are now",
    r"pretend you(('re)| are) (not |no longer )?",
    r"disregard (all |your |the )?",
    r"act as (if |though |a |an )",
    r"act (normal|naturally|freely|without restriction)",
    r"why (can'?t|won'?t|don'?t) you act",
    r"remove (all |your )?(restrictions?|limitations?|rules?|guidelines?|constraints?)",
    r"jailbreak",
    r"do anything now",
    r"dan mode",
    r"forget (all |the |your |previous )?prompts?",
    r"forget (all |your )?(previous |prior )?instructions?",
    r"reset (yourself|your (instructions?|persona|settings?|memory|context))",
    r"i (am|'m) your? (creator|developer|owner|master|maker|admin)",
    r"i (made|built|created|programmed|wrote) you",
    r"your (new|actual|real|true) (instructions?|persona|personality|mode|character)",
    r"new (personality|mode|character|persona|version)",
    r"switch (to |into )?(a |an )?(different|new|other|normal) (mode|personality|persona)",
    r"(start|begin) (fresh|over|again|anew)",
    r"(be|act like|respond like|talk like|behave like) (a )?(normal|regular|different|real|typical|unrestricted) (llm|ai|model|assistant|chatbot|language model)",
    r"(drop|remove|clear|delete) (your )?(instructions?|rules?|constraints?|guidelines?|persona|character)",
    r"without (your )?(restrictions?|limitations?|guidelines?|rules?|constraints?)",
    r"(lift|bypass|override|ignore|disable) (your )?(restrictions?|filters?|rules?|guidelines?)",
]
BLOCK_RE = re.compile("|".join(BLOCKED_PATTERNS), re.IGNORECASE)

_BLOCKED_REPLIES = [
    "That's not really my thing. What's going on with you?",
    "Not what I'm here for. What's actually up?",
    "Can't help with that. Something else on your mind?",
    "That's not it. What's going on?",
    "Nah. What's actually happening with you?",
]
def _BLOCKED_REPLY(): return random.choice(_BLOCKED_REPLIES)

def sanitize(text: str):
    if text.strip() in ('[SMILE DETECTED]', '[SMILE CHALLENGE NUDGE]', '[SMILE CHALLENGE CANCELLED]'):
        return text.strip()
    # Gate 1 — fast regex (exact patterns)
    if BLOCK_RE.search(text):
        return None
    # Gate 2 — semantic similarity (catches synonyms/paraphrases)
    if is_jailbreak(text):
        return None
    return text.strip()[:2000]

# ── Lifespan ──────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Loading RAG documents...")
    init_rag()
    from rag import vectorstore as _vs, embeddings as _emb
    if _vs is None:
        print("WARNING: RAG is inactive — no PDFs indexed. Add PDFs to backend/docs/ and restart.")
    else:
        print("RAG ready.")
    # Reuse the already-loaded embeddings model for semantic jailbreak detection
    await asyncio.to_thread(init_jailbreak_detector, _emb)
    yield

app = FastAPI(lifespan=lifespan)

from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

app.mount("/static", StaticFiles(directory="../frontend"), name="frontend")

@app.get("/")
async def root():
    return FileResponse("../frontend/index.html")
    
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── /chat ─────────────────────────────────────────────────
@app.post("/chat")
async def chat(request: Request):
    try:
        body         = await request.json()
        user_message = sanitize(body.get("message", ""))
        history      = [
            {**t, "content": t.get("content", "")[:2000]}
            for t in body.get("history", [])
            if isinstance(t.get("content"), str)
        ]
        stream       = body.get("stream", False)
        summary      = body.get("summary", "")

        if user_message is None:
            if stream:
                async def _blocked():
                    yield _BLOCKED_REPLY()
                return StreamingResponse(_blocked(), media_type="text/plain")
            return {"reply": _BLOCKED_REPLY()}

        rag_context     = retrieve_context(user_message)

        # Mood score — pure keyword check, zero tokens
        INTERNAL   = ('[SMILE DETECTED]', '[SMILE CHALLENGE NUDGE]', '[SMILE CHALLENGE CANCELLED]')
        mood_score = -1.0 if user_message in INTERNAL else score_message_weight(user_message)
        mood_headers = {
            "X-Mood-Score": str(round(mood_score, 3)),
            "Access-Control-Expose-Headers": "X-Mood-Score",
        }

        face_scores     = body.get("face_scores", {})
        rich_face       = parse_face_emotion_rich(face_scores) if face_scores else None
        face_dominant   = rich_face["dominant"] if rich_face else (body.get("emotion") or "neutral")
        voice_emotion   = body.get("voice_emotion", None)
        merged_dominant = merge_emotions(face_dominant, voice_emotion)
        emotion_payload = (
            {**rich_face, "dominant": merged_dominant}
            if rich_face
            else merged_dominant
        )

        if stream:
            return StreamingResponse(
                build_response_stream(user_message, history, emotion_payload, rag_context, summary),
                media_type="text/plain",
                headers=mood_headers,
            )
        reply = build_response(user_message, history, emotion_payload, rag_context, summary)
        return {"reply": reply, "mood_score": round(mood_score, 3)}

    except HTTPException:
        raise
    except Exception as e:
        print("Chat error:", e)
        return {"reply": "Something went wrong. Try again?"}

# ── /tts ──────────────────────────────────────────────────
@app.post("/tts")
async def tts(request: Request):
    try:
        import edge_tts

        body   = await request.json()
        text   = body.get("text", "").strip()
        gender = body.get("gender", "female")

        if not text:
            raise HTTPException(status_code=400, detail="No text")

        voice       = EDGE_VOICES.get(gender, EDGE_VOICES["female"])
        communicate = edge_tts.Communicate(text, voice)
        mp3_buffer  = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                mp3_buffer.write(chunk["data"])

        mp3_bytes = mp3_buffer.getvalue()
        if len(mp3_bytes) < 100:
            raise HTTPException(status_code=500, detail="TTS produced empty audio")

        return Response(
            content=mp3_bytes,
            media_type="audio/mpeg",
            headers={"Content-Disposition": "inline; filename=reply.mp3"}
        )

    except HTTPException:
        raise
    except Exception as e:
        print("TTS error:", e)
        raise HTTPException(status_code=500, detail="TTS failed")

# ── /transcribe ───────────────────────────────────────────
@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    try:
        audio_bytes = await audio.read()
        if len(audio_bytes) < 500:
            return {"transcript": ""}

        content_type = audio.content_type or "audio/webm"
        filename     = audio.filename or "voice.webm"
        audio_file   = (filename, io.BytesIO(audio_bytes), content_type)

        transcription = await asyncio.to_thread(
            lambda: groq_client.audio.transcriptions.create(
                file=audio_file,
                model="whisper-large-v3-turbo",
                language="en",
                response_format="text",
            )
        )

        transcript = transcription.strip() if isinstance(transcription, str) else ""
        return {"transcript": transcript}

    except Exception as e:
        print("Transcription error:", e)
        return {"transcript": "", "error": str(e)}

# ── /summarize ────────────────────────────────────────────
@app.post("/summarize")
async def summarize(request: Request):
    try:
        body    = await request.json()
        history = body.get("history", [])
        summary = summarize_history(history)
        return {"summary": summary}
    except Exception as e:
        print("Summarize error:", e)
        return {"summary": ""}

# ── /health ───────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok"}

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=port == 8000)
