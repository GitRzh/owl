"""
emotion.py

Face emotion: receives raw face-api.js expression scores and returns
a dominant label or a rich dict with secondary signals.

Voice emotion parsing is not currently wired from the frontend —
merge_emotions handles the case where voice_emotion is None.
"""

FACE_EMOTIONS = ["happy", "sad", "angry", "fearful", "disgusted", "surprised", "neutral"]

def parse_face_emotion(scores: dict) -> str:
    """Pick the highest-confidence face emotion from face-api.js scores."""
    if not scores:
        return "neutral"
    valid = {k: v for k, v in scores.items() if k in FACE_EMOTIONS}
    if not valid:
        return "neutral"
    dominant = max(valid, key=valid.get)
    return dominant if valid[dominant] >= 0.25 else "neutral"

def parse_face_emotion_rich(scores: dict) -> dict:
    """
    Return dominant + secondary emotions with confidence scores.
    Gives the model richer context — e.g. fearful+angry reads differently
    from fearful+sad.
    """
    if not scores:
        return {"dominant": "neutral", "secondary": [], "scores": {}}
    valid = {k: v for k, v in scores.items() if k in FACE_EMOTIONS and v >= 0.08}
    if not valid:
        return {"dominant": "neutral", "secondary": [], "scores": {}}

    sorted_emotions = sorted(valid.items(), key=lambda x: x[1], reverse=True)
    dominant = sorted_emotions[0][0] if sorted_emotions[0][1] >= 0.25 else "neutral"
    secondary = [
        {"label": e, "score": round(s, 2)}
        for e, s in sorted_emotions[1:3]
        if s >= 0.10 and e != "neutral"
    ]
    return {
        "dominant": dominant,
        "secondary": secondary,
        "scores": {e: round(s, 2) for e, s in sorted_emotions[:3]},
    }

def merge_emotions(face_emotion: str | None, voice_emotion: str | None) -> str:
    """
    Merge face + voice signals. Face takes priority when non-neutral.
    Voice fills the gap when face is neutral.
    voice_emotion is currently always None (not wired from frontend).
    """
    face  = face_emotion  or "neutral"
    voice = voice_emotion or "neutral"
    if face != "neutral":
        return face
    if voice != "neutral":
        return voice
    return "neutral"