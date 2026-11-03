import base64

from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.services.colab_client import (
    chat_with_colab,
    rag_text_with_colab,
    rag_speech_with_colab,
    speech_with_colab,
    store_document_with_colab,
    set_sts_speaker_with_colab,
)

app = FastAPI(
    title="AI Assistant API"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Bot-Text-B64"],
)


class RagTextRequest(BaseModel):
    query: str


class StsModeRequest(BaseModel):
    speaker_version: str


@app.get("/")
def root():
    return {
        "message": "AI Assistant API is running"
    }


@app.get("/health")
def health():
    return {
        "status": "ok"
    }


@app.post("/api/store")
async def store(file: UploadFile = File(...)):
    content, media_type = await store_document_with_colab(file)
    return Response(content=content, media_type=media_type)


@app.post("/api/rag_text")
async def rag_text(payload: RagTextRequest):
    return await rag_text_with_colab(payload.query)


@app.post("/api/rag_speech")
async def rag_speech(
    audio: UploadFile = File(...),
    speaker_mode: str = Form("v2/en_speaker_6"),
):
    speaker_mode = speaker_mode.strip()
    if not speaker_mode:
        raise HTTPException(status_code=422, detail="speaker_mode cannot be empty.")

    audio_content, bot_text = await rag_speech_with_colab(audio, speaker_mode)
    encoded_bot_text = base64.b64encode(bot_text.encode("utf-8")).decode("ascii")
    return Response(
        content=audio_content,
        media_type="audio/wav",
        headers={"X-Bot-Text-B64": encoded_bot_text},
    )


@app.post("/api/chat")
async def chat(
    message: str = Form(""),
    files: list[UploadFile] = File(default=[]),
):
    if not message.strip() and not files:
        raise HTTPException(
            status_code=422,
            detail="A message or at least one document must be included.",
        )

    result = await chat_with_colab(
        message,
        files,
    )

    return result


@app.post("/api/speech")
async def speech(
    audio: UploadFile = File(...),
    message: str = Form(""),
    files: list[UploadFile] = File(default=[]),
    speaker_mode: str = Form("v2/en_speaker_6"),
):
    if not audio.filename:
        raise HTTPException(status_code=422, detail="The audio file must have a name.")

    speaker_mode = speaker_mode.strip()
    if not speaker_mode:
        raise HTTPException(status_code=422, detail="speaker_mode cannot be empty.")

    audio_content, bot_text = await speech_with_colab(
        audio,
        message,
        files,
        speaker_mode,
    )
    encoded_bot_text = base64.b64encode(bot_text.encode("utf-8")).decode("ascii")
    return Response(
        content=audio_content,
        media_type="audio/wav",
        headers={"X-Bot-Text-B64": encoded_bot_text},
    )


@app.post("/api/sts_mode")
async def sts_mode(payload: StsModeRequest):
    speaker_version = payload.speaker_version.strip()
    if not speaker_version:
        raise HTTPException(status_code=422, detail="speaker_version cannot be empty.")
    return await set_sts_speaker_with_colab(speaker_version)