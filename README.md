# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Backend Colab endpoint

Configure the active Colab tunnel in `backend/.env`:

```env
COLAB_URL=https://your-ngrok-domain
COLAB_STORE_PATH=/store
COLAB_RAG_TEXT_PATH=/rag_text
COLAB_RAG_SPEECH_PATH=/rag_speech
COLAB_CHAT_PATH=/chat
COLAB_SPEECH_PATH=/speech
```

`COLAB_STORE_PATH`, `COLAB_RAG_TEXT_PATH`, `COLAB_RAG_SPEECH_PATH`, `COLAB_CHAT_PATH`, and `COLAB_SPEECH_PATH` must match the POST routes exposed by the Kaggle app. They default to `/store`, `/rag_text`, `/rag_speech`, `/chat`, and `/speech`. Restart the backend after changing these values.

The Document page uploads each chosen document to the backend's `POST /api/store`, which forwards it to Kaggle's `POST /store` as multipart field `file`. A typed prompt is sent as JSON (`{"query": "..."}`) to `POST /api/rag_text`, which forwards it to Kaggle's `POST /rag_text`; Kaggle should return the LLM response as a string. The chat input stays disabled until the selected document has been stored successfully. The Document page's **Speech** control records while held and sends the audio as multipart field `audio` to `POST /api/rag_speech`, which forwards it to Kaggle's `POST /rag_speech`. Kaggle should return WAV audio with the chatbot text in the `X-Bot-Text-B64` response header; the backend exposes that header to the browser, where the text is shown and the audio is played automatically.

If the backend reports a 404, check `COLAB_URL/openapi.json` in a browser. It should return the FastAPI schema and list `/chat` and `/speech`. If `/openapi.json` also returns an HTML 404, the configured URL is not the active Kaggle FastAPI tunnel; copy the current public tunnel URL from the running Kaggle notebook into `COLAB_URL`. Kaggle tunnel URLs can change when the notebook session restarts. Keep `COLAB_CHAT_PATH=/chat` and `COLAB_SPEECH_PATH=/speech` when those are the routes listed by OpenAPI.

The chat composer accepts PDF, DOCX, TXT, CSV, and XLSX attachments (maximum 5 files, 10 MB each, and 25 MB total). `POST /api/chat` sends `message` and repeated multipart `files` fields to Kaggle's `POST /chat`. The **Speech** button records only while held. Releasing it sends `audio`, optional typed `message`, and repeated `files` fields to `POST /api/speech`; the backend forwards them to Kaggle's `POST /speech`. The Kaggle routes must extract the document text and include it in the same user prompt as the text message or speech transcript. Install `pypdf`, `python-docx`, and `openpyxl` in Kaggle to read PDF, DOCX, and XLSX files; CSV uses Python's standard library. Scanned PDFs need OCR. The browser may record WebM/Opus, so `/speech` should convert the upload to WAV before passing it to the speech-to-text model. It then sends the WAV response body and chatbot text in an `X-Bot-Text-B64` response header (base64-encoded UTF-8).

If Kaggle logs `POST /chat` with HTTP 422, the request reached the chat route but its declared parameters do not match the multipart request. Update and restart the Kaggle notebook route to accept `message: str = Form("")` and `files: list[UploadFile] = File(default=[])`; the old JSON-body `ChatRequest` route will reject multipart submissions. The local backend now includes Kaggle's validation detail in the returned error to identify the field that was rejected. Text submissions use `/chat`; only microphone submissions use `/speech`.

Add the following document reader to the Kaggle notebook and adapt both routes to accept multipart form fields. The backend validates the same file extensions and size limits; validate again in Kaggle because the notebook route is also publicly reachable through its tunnel.

```python
import io
import csv
from pathlib import Path

from docx import Document
from fastapi import File, Form, HTTPException, UploadFile
from openpyxl import load_workbook
from pypdf import PdfReader

MAX_FILE_SIZE = 10 * 1024 * 1024
SUPPORTED_EXTENSIONS = {".csv", ".docx", ".pdf", ".txt", ".xlsx"}


async def extract_attachment_context(files: list[UploadFile]) -> str:
    if len(files) > 5:
        raise HTTPException(status_code=413, detail="Maksimal 5 dokumen.")

    sections = []
    total_size = 0
    for file in files:
        filename = (file.filename or "").replace("\\", "/").rsplit("/", 1)[-1]
        suffix = Path(filename).suffix.lower()
        if not filename or suffix not in SUPPORTED_EXTENSIONS:
            raise HTTPException(
                status_code=415,
                detail="Format dokumen yang didukung: PDF, DOCX, TXT, CSV, dan XLSX.",
            )

        content = await file.read(MAX_FILE_SIZE + 1)
        if not content:
            raise HTTPException(
                status_code=422,
                detail=f"Dokumen {filename} kosong.",
            )
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"Ukuran dokumen {filename} melebihi batas 10 MB.",
            )
        total_size += len(content)
        if total_size > 25 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Total dokumen melebihi 25 MB.")

        if suffix == ".pdf":
            text = "\n".join(
                page.extract_text() or ""
                for page in PdfReader(io.BytesIO(content)).pages
            )
        elif suffix == ".docx":
            document = Document(io.BytesIO(content))
            text = "\n".join(paragraph.text for paragraph in document.paragraphs)
        elif suffix == ".csv":
            try:
                csv_text = content.decode("utf-8-sig")
            except UnicodeDecodeError as exc:
                raise HTTPException(
                    status_code=422,
                    detail=f"Dokumen {filename} bukan CSV UTF-8 yang valid.",
                ) from exc
            rows = csv.reader(io.StringIO(csv_text))
            text = "\n".join(" | ".join(row) for row in rows)
        elif suffix == ".xlsx":
            workbook = load_workbook(
                io.BytesIO(content),
                read_only=True,
                data_only=True,
            )
            try:
                sheets = []
                for worksheet in workbook.worksheets:
                    rows = (
                        " | ".join("" if value is None else str(value) for value in row)
                        for row in worksheet.iter_rows(values_only=True)
                    )
                    sheet_text = "\n".join(rows)
                    sheets.append(f"Sheet: {worksheet.title}\n{sheet_text}")
                text = "\n\n".join(sheets)
            finally:
                workbook.close()
        else:
            try:
                text = content.decode("utf-8-sig")
            except UnicodeDecodeError as exc:
                raise HTTPException(
                    status_code=422,
                    detail=f"Dokumen {filename} bukan teks UTF-8 yang valid.",
                ) from exc

        if not text.strip():
            raise HTTPException(
                status_code=422,
                detail=f"Tidak ada teks yang dapat diekstrak dari {filename}.",
            )
        sections.append(f"--- Dokumen: {filename} ---\n{text}")

    return "\n\n".join(sections)


def make_user_prompt(user_text: str, attachment_context: str) -> str:
    prompt = user_text.strip() or "Analisis dokumen terlampir dan rangkum poin pentingnya."
    if attachment_context:
        prompt += f"\n\nKonteks dokumen terlampir:\n{attachment_context}"
    return prompt
```

In `/chat`, declare `message: str = Form("")` and `files: list[UploadFile] = File(default=[])`, then pass `make_user_prompt(message, await extract_attachment_context(files))` to the same LLM generation code used by the notebook. In `/speech`, accept those same `message` and `files` form fields alongside `audio`. After transcription, combine the typed text and transcript, pass that text plus `await extract_attachment_context(files)` through `make_user_prompt`, and use the resulting prompt for LLM generation. This way both modes use the exact same document context.

Example `/chat` route using the existing notebook model variables:

```python
@app.post("/chat")
async def chat(
    message: str = Form(""),
    files: list[UploadFile] = File(default=[]),
):
    if not message.strip() and not files:
        raise HTTPException(
            status_code=422,
            detail="Pesan atau setidaknya satu dokumen harus disertakan.",
        )

    attachment_context = await extract_attachment_context(files)
    user_prompt = make_user_prompt(message, attachment_context)
    messages = [
        {
            "role": "system",
            "content": "You are a helpful assistant. Answer clearly and accurately.",
        },
        {"role": "user", "content": user_prompt},
    ]
    prompt = llm_tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
    )
    inputs = llm_tokenizer(prompt, return_tensors="pt").to(device_llm)
    outputs = llm_model.generate(
        **inputs,
        max_new_tokens=500,
        do_sample=True,
        temperature=0.7,
        top_p=0.9,
    )
    bot_text = llm_tokenizer.decode(
        outputs[0][inputs.input_ids.shape[1]:],
        skip_special_tokens=True,
    ).strip()
    return {"response": bot_text}
```

Example Kaggle implementation for the `sts_mode` and `/speech` API:

```python
import base64
import io
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from fastapi import File, Form, HTTPException, UploadFile
from fastapi.responses import Response

def sts_mode(
    audio_input_path: str | Path,
    message: str = "",
    attachment_context: str = "",
):
    # Transformers ASR expects a NumPy array/tensor (or its documented input
    # dictionary), not a pathlib.Path.
    audio_array, audio_sample_rate = sf.read(
        str(audio_input_path),
        dtype="float32",
    )
    if audio_array.size == 0:
        raise ValueError("Audio input WAV kosong.")

    stt_result = stt_pipeline(
        {
            "raw": audio_array,
            "sampling_rate": audio_sample_rate,
        }
    )
    transcript = stt_result["text"].strip()
    user_text = "\n\n".join(
        part for part in (message.strip(), transcript) if part
    )
    model_prompt = make_user_prompt(user_text, attachment_context)

    messages = [
        {
            "role": "system",
            "content": (
                "You are a friendly voice assistant. Answer concisely and clearly "
                "without markdown so the response is suitable for text-to-speech."
            ),
        },
        {"role": "user", "content": model_prompt},
    ]
    prompt = llm_tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
    )
    inputs = llm_tokenizer(prompt, return_tensors="pt").to(device_llm)
    outputs = llm_model.generate(
        **inputs,
        max_new_tokens=500,
        do_sample=True,
        temperature=0.7,
        top_p=0.9,
    )
    bot_text = llm_tokenizer.decode(
        outputs[0][inputs.input_ids.shape[1]:],
        skip_special_tokens=True,
    ).strip()

    audio_array = generate_long_audio(bot_text)
    if isinstance(audio_array, torch.Tensor):
        audio_array = audio_array.detach().cpu().numpy()
    audio_array = np.asarray(audio_array, dtype=np.float32)

    # Return the actual samples, not IPython.display.Audio. Audio() is for
    # notebook display and does not provide a WAV file path.
    return {
        "user_text": user_text,
        "bot_text": bot_text,
        "audio_array": audio_array,
        "sample_rate": SAMPLE_RATE,
    }


@app.post("/speech")
async def speech(
    audio: UploadFile = File(...),
    message: str = Form(""),
    files: list[UploadFile] = File(default=[]),
):
    suffix = Path(audio.filename or "speech.webm").suffix or ".webm"
    with tempfile.TemporaryDirectory() as temp_dir:
        source_path = Path(temp_dir) / f"input{suffix}"
        wav_path = Path(temp_dir) / "input.wav"
        source_path.write_bytes(await audio.read())

        conversion = subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(source_path),
                "-vn", "-ac", "1", "-ar", "16000",
                "-c:a", "pcm_s16le", str(wav_path),
            ],
            capture_output=True,
            text=True,
        )
        if conversion.returncode != 0:
            raise HTTPException(
                status_code=400,
                detail=f"Audio tidak dapat dikonversi ke WAV: {conversion.stderr[-1000:]}",
            )

        attachment_context = await extract_attachment_context(files)
        result = sts_mode(wav_path, message, attachment_context)
        wav_buffer = io.BytesIO()
        sf.write(
            wav_buffer,
            result["audio_array"],
            result["sample_rate"],
            format="WAV",
            subtype="PCM_16",
        )
        bot_text = base64.b64encode(
            result["bot_text"].encode("utf-8")
        ).decode("ascii")
        return Response(
            content=wav_buffer.getvalue(),
            media_type="audio/wav",
            headers={"X-Bot-Text-B64": bot_text},
        )
```

Replace the STT portion of the current `sts_mode` with `sf.read(...)` and pass the returned array plus its sample rate to the pipeline. In particular, do not call `stt_pipeline(wav_path)`: the file path is useful for decoding the WAV, but is not the model input expected in the reported error. The upload conversion uses mono, 16 kHz, 16-bit PCM; `sf.read(..., dtype="float32")` then produces samples and their actual sample rate.

Also change `sts_mode` to return `audio_array` and `sample_rate`, rather than `IPython.display.Audio(...)`. That notebook display object is not a file and has no `.path` attribute. The endpoint above writes the generated samples into a WAV response in memory. `torch` is used only to convert a generated tensor to a NumPy array; remove that conversion branch if `generate_long_audio` is guaranteed to return a NumPy array.

Install/import `soundfile` and ensure `ffmpeg` is available in the Kaggle environment. If notebook playback is useful during development, call `display(Audio(result["audio_array"], rate=result["sample_rate"]))` separately; do not use the display object as the API audio file. The backend exposes `X-Bot-Text-B64` through CORS for the frontend to read.
