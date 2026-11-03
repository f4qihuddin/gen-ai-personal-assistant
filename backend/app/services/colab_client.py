import base64
import binascii
import os
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from dotenv import load_dotenv
from fastapi import HTTPException, UploadFile


BACKEND_ENV = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(BACKEND_ENV)

COLAB_URL = os.getenv("COLAB_URL", "").strip().rstrip("/")
COLAB_STORE_PATH = os.getenv("COLAB_STORE_PATH", "/store").strip() or "/store"
if not COLAB_STORE_PATH.startswith("/"):
    COLAB_STORE_PATH = f"/{COLAB_STORE_PATH}"
COLAB_STORE_PATH = COLAB_STORE_PATH.rstrip("/") or "/"
COLAB_RAG_TEXT_PATH = os.getenv("COLAB_RAG_TEXT_PATH", "/rag_text").strip() or "/rag_text"
if not COLAB_RAG_TEXT_PATH.startswith("/"):
    COLAB_RAG_TEXT_PATH = f"/{COLAB_RAG_TEXT_PATH}"
COLAB_RAG_TEXT_PATH = COLAB_RAG_TEXT_PATH.rstrip("/") or "/"
COLAB_RAG_SPEECH_PATH = os.getenv("COLAB_RAG_SPEECH_PATH", "/rag_speech").strip() or "/rag_speech"
if not COLAB_RAG_SPEECH_PATH.startswith("/"):
    COLAB_RAG_SPEECH_PATH = f"/{COLAB_RAG_SPEECH_PATH}"
COLAB_RAG_SPEECH_PATH = COLAB_RAG_SPEECH_PATH.rstrip("/") or "/"
COLAB_CHAT_PATH = os.getenv("COLAB_CHAT_PATH", "/chat").strip() or "/chat"
if not COLAB_CHAT_PATH.startswith("/"):
    COLAB_CHAT_PATH = f"/{COLAB_CHAT_PATH}"
COLAB_CHAT_PATH = COLAB_CHAT_PATH.rstrip("/") or "/"
COLAB_SPEECH_PATH = os.getenv("COLAB_SPEECH_PATH", "/speech").strip() or "/speech"
if not COLAB_SPEECH_PATH.startswith("/"):
    COLAB_SPEECH_PATH = f"/{COLAB_SPEECH_PATH}"
COLAB_SPEECH_PATH = COLAB_SPEECH_PATH.rstrip("/") or "/"
COLAB_STS_MODE_PATH = os.getenv("COLAB_STS_MODE_PATH", "/sts_mode").strip() or "/sts_mode"
if not COLAB_STS_MODE_PATH.startswith("/"):
    COLAB_STS_MODE_PATH = f"/{COLAB_STS_MODE_PATH}"
COLAB_STS_MODE_PATH = COLAB_STS_MODE_PATH.rstrip("/") or "/"

SUPPORTED_ATTACHMENT_EXTENSIONS = {".csv", ".docx", ".pdf", ".txt", ".xlsx"}
MAX_ATTACHMENT_COUNT = 5
MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024
MAX_TOTAL_ATTACHMENT_SIZE = 25 * 1024 * 1024


def _get_colab_url(path: str) -> str:
    base_url = COLAB_URL.rstrip("/")
    base_path = urlsplit(base_url).path.rstrip("/")
    if base_path == path or base_path.endswith(path):
        return base_url
    return f"{base_url}{path}"


async def _prepare_attachments(
    attachments: list[UploadFile],
) -> list[tuple[str, tuple[str, bytes, str]]]:
    if len(attachments) > MAX_ATTACHMENT_COUNT:
        raise HTTPException(
            status_code=413,
            detail=f"A maximum of {MAX_ATTACHMENT_COUNT} documents can be sent at once.",
        )

    prepared_files = []
    total_size = 0
    for attachment in attachments:
        original_name = attachment.filename or ""
        filename = original_name.replace("\\", "/").rsplit("/", 1)[-1]
        suffix = Path(filename).suffix.lower()
        if not filename or suffix not in SUPPORTED_ATTACHMENT_EXTENSIONS:
            raise HTTPException(
                status_code=415,
                detail="Supported document formats: PDF, DOCX, TXT, CSV, and XLSX.",
            )

        content = await attachment.read(MAX_ATTACHMENT_SIZE + 1)
        if not content:
            raise HTTPException(
                status_code=422,
                detail=f"Document {filename} is empty.",
            )
        if len(content) > MAX_ATTACHMENT_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"Document {filename} exceeds the 10 MB limit.",
            )

        total_size += len(content)
        if total_size > MAX_TOTAL_ATTACHMENT_SIZE:
            raise HTTPException(
                status_code=413,
                detail="The total document size cannot exceed 25 MB.",
            )

        prepared_files.append(
            (
                "files",
                (
                    filename,
                    content,
                    attachment.content_type or "application/octet-stream",
                ),
            )
        )

    return prepared_files


async def _route_failure_detail(
    client: httpx.AsyncClient,
    response: httpx.Response,
    endpoint_path: str,
    path_setting: str,
    validation_hint: str | None = None,
) -> str:
    if response.status_code == 422:
        try:
            result = response.json()
        except ValueError:
            result = {}

        errors = result.get("detail") if isinstance(result, dict) else None
        if isinstance(errors, list):
            validation_details = "; ".join(
                "{}: {}".format(
                    ".".join(str(part) for part in error.get("loc", []))
                    or "request",
                    error.get("msg", "invalid input"),
                )
                for error in errors
                if isinstance(error, dict)
            )
        elif isinstance(errors, str):
            validation_details = errors
        else:
            validation_details = ""

        detail = f"Kaggle rejected the request format for {endpoint_path} (HTTP 422). "
        if validation_hint:
            detail += validation_hint
        else:
            detail += (
                "Make sure the Kaggle route accepts the multipart field 'message' as "
                "Form(...) and 'files' as list[UploadFile] = File(...), "
                "not as a ChatRequest parameter."
            )
        if validation_details:
            detail += f" Detail validasi Kaggle: {validation_details[:1000]}"
            if "body.request" in validation_details:
                detail += (
                    " FastAPI is requesting a ChatRequest body named 'request'; "
                    "remove that parameter and read message directly from Form."
                )
        return detail

    if response.status_code != 404:
        return (
            f"The Kaggle service returned HTTP {response.status_code} "
            f"at {endpoint_path}. Check the Kaggle application logs."
        )

    try:
        openapi_response = await client.get(_get_colab_url("/openapi.json"))
    except httpx.RequestError:
        return (
            f"Path {endpoint_path} returned HTTP 404, and the backend could not "
            "inspect /openapi.json. Make sure COLAB_URL is the active public "
            "Kaggle tunnel URL."
        )

    try:
        schema = openapi_response.json()
        paths = (
            schema.get("paths", {})
            if openapi_response.is_success and isinstance(schema, dict)
            else {}
        )
    except ValueError:
        schema = {}
        paths = {}

    if isinstance(paths, dict):
        route = paths.get(endpoint_path)
        if isinstance(route, dict):
            methods = ", ".join(
                method.upper()
                for method in route
                if isinstance(method, str)
            )
            if "post" not in route:
                return (
                    f"FastAPI Kaggle is running, but {endpoint_path} does not accept "
                    f"POST (available methods: {methods or 'unknown'}). "
                    f"Check the route and COLAB_{path_setting}."
                )
            return (
                f"OpenAPI Kaggle registers POST {endpoint_path}, but the request "
                "still returns 404. Check whether the tunnel forwards to the "
                "same FastAPI process."
            )

        if openapi_response.is_success and isinstance(schema, dict):
            available_routes = ", ".join(sorted(paths)) or "(none)"
            return (
                f"FastAPI Kaggle is running, but OpenAPI does not register "
                f"{endpoint_path}. Available routes: {available_routes}. "
                f"Check COLAB_{path_setting} or restart the Kaggle app."
            )

    return (
        f"The URL in COLAB_URL does not appear to point to the active Kaggle FastAPI: "
        f"GET /openapi.json returned HTTP {openapi_response.status_code} "
        f"with Content-Type {openapi_response.headers.get('content-type', 'unknown')}. "
        "Update COLAB_URL with the public Kaggle tunnel URL for the active session."
    )


async def store_document_with_colab(attachment: UploadFile) -> tuple[bytes, str]:
    if not COLAB_URL:
        raise HTTPException(
            status_code=500,
            detail="COLAB_URL belum dikonfigurasi di backend/.env.",
        )

    prepared_files = await _prepare_attachments([attachment])
    _, file_payload = prepared_files[0]
    url = _get_colab_url(COLAB_STORE_PATH)

    try:
        async with httpx.AsyncClient(timeout=600, follow_redirects=True) as client:
            response = await client.post(url, files=[("file", file_payload)])
            if not response.is_success:
                detail = await _route_failure_detail(
                    client,
                    response,
                    urlsplit(url).path,
                    "STORE_PATH",
                    "Make sure the Kaggle route accepts the multipart field 'file' as UploadFile.",
                )
                raise HTTPException(status_code=502, detail=detail)
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=504,
            detail="Timed out while saving the document in Kaggle. Check the Kaggle server and tunnel.",
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail="The backend cannot reach Kaggle. Check the tunnel URL and make sure the notebook is active.",
        ) from exc

    return response.content, response.headers.get("content-type", "application/json")


async def rag_text_with_colab(query: str) -> str:
    if not COLAB_URL:
        raise HTTPException(
            status_code=500,
            detail="COLAB_URL is not configured in backend/.env.",
        )
    if not query.strip():
        raise HTTPException(status_code=422, detail="Prompt cannot be empty.")

    url = _get_colab_url(COLAB_RAG_TEXT_PATH)
    try:
        async with httpx.AsyncClient(timeout=600, follow_redirects=True) as client:
            response = await client.post(url, json={"query": query})
            if not response.is_success:
                detail = await _route_failure_detail(
                    client,
                    response,
                    urlsplit(url).path,
                    "RAG_TEXT_PATH",
                    "Make sure the Kaggle route accepts a JSON body with a string field named 'query'.",
                )
                raise HTTPException(status_code=502, detail=detail)
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=504,
            detail="The Kaggle RAG pipeline timed out. Check the Kaggle server and tunnel.",
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail="The backend cannot reach Kaggle. Check the tunnel URL and make sure the notebook is active.",
        ) from exc

    try:
        result = response.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=502,
            detail="The Kaggle /rag_text endpoint did not return a valid JSON string.",
        ) from exc

    if not isinstance(result, str):
        raise HTTPException(
            status_code=502,
            detail="The Kaggle /rag_text response must be a string.",
        )

    return result


async def rag_speech_with_colab(
    audio: UploadFile,
    speaker_mode: str = "v2/en_speaker_6",
) -> tuple[bytes, str]:
    if not COLAB_URL:
        raise HTTPException(
            status_code=500,
            detail="COLAB_URL belum dikonfigurasi di backend/.env.",
        )
    if not audio.filename:
        raise HTTPException(status_code=422, detail="The audio file must have a name.")

    filename = audio.filename.replace("\\", "/").rsplit("/", 1)[-1]
    suffix = Path(filename).suffix.lower()
    if suffix not in {".webm", ".ogg", ".mp4", ".wav"}:
        raise HTTPException(status_code=415, detail="Audio format is not supported.")

    audio_content = await audio.read()
    if not audio_content:
        raise HTTPException(status_code=422, detail="The audio file is empty.")

    url = _get_colab_url(COLAB_RAG_SPEECH_PATH)
    try:
        async with httpx.AsyncClient(timeout=600, follow_redirects=True) as client:
            response = await client.post(
                url,
                data={"speaker_mode": speaker_mode},
                files=[
                    (
                        "audio",
                        (
                            filename,
                            audio_content,
                            audio.content_type or "application/octet-stream",
                        ),
                    )
                ],
            )
            if not response.is_success:
                detail = await _route_failure_detail(
                    client,
                    response,
                    urlsplit(url).path,
                    "RAG_SPEECH_PATH",
                    "Make sure the Kaggle route accepts the multipart field 'audio' as UploadFile.",
                )
                raise HTTPException(status_code=502, detail=detail)
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=504,
            detail="The Kaggle speech-to-speech RAG pipeline timed out. Check the Kaggle server and tunnel.",
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail="The backend cannot reach Kaggle. Check the tunnel URL and make sure the notebook is active.",
        ) from exc

    if not response.content or not response.headers.get("content-type", "").startswith(
        "audio/"
    ):
        raise HTTPException(
            status_code=502,
            detail="The Kaggle /rag_speech endpoint did not return an audio file.",
        )

    encoded_text = response.headers.get("x-bot-text-b64")
    if not encoded_text:
        raise HTTPException(
            status_code=502,
            detail="The Kaggle /rag_speech response is missing the X-Bot-Text-B64 header.",
        )

    try:
        bot_text = base64.b64decode(encoded_text, validate=True).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError) as exc:
        raise HTTPException(
            status_code=502,
            detail="The /rag_speech Kaggle X-Bot-Text-B64 header is not valid UTF-8 base64 text.",
        ) from exc

    return response.content, bot_text


async def chat_with_colab(message: str, attachments: list[UploadFile]):
    if not COLAB_URL:
        raise HTTPException(
            status_code=500,
            detail="COLAB_URL belum dikonfigurasi di backend/.env.",
        )

    url = _get_colab_url(COLAB_CHAT_PATH)
    prepared_files = await _prepare_attachments(attachments)

    try:
        async with httpx.AsyncClient(timeout=600, follow_redirects=True) as client:
            response = await client.post(
                url,
                data={"message": message},
                files=prepared_files,
            )
            if not response.is_success:
                detail = await _route_failure_detail(
                    client,
                    response,
                    urlsplit(url).path,
                    "CHAT_PATH",
                )
                raise HTTPException(status_code=502, detail=detail)
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=504,
            detail="The Colab service timed out. Check the Colab server and ngrok tunnel.",
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail="The backend cannot reach Colab. Check the ngrok URL and make sure the tunnel is active.",
        ) from exc

    try:
        result = response.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=502,
            detail="The Colab service did not return valid JSON.",
        ) from exc

    if not isinstance(result, dict) or not isinstance(result.get("response"), str):
        raise HTTPException(
            status_code=502,
            detail="The Colab response format is invalid; it must contain a string field named 'response'.",
        )

    return result


async def speech_with_colab(
    audio: UploadFile,
    message: str,
    attachments: list[UploadFile],
    speaker_mode: str = "v2/en_speaker_6",
) -> tuple[bytes, str]:
    if not COLAB_URL:
        raise HTTPException(
            status_code=500,
            detail="COLAB_URL belum dikonfigurasi di backend/.env.",
        )

    audio_content = await audio.read()
    if not audio_content:
        raise HTTPException(status_code=422, detail="The audio file cannot be empty.")

    prepared_files = await _prepare_attachments(attachments)
    prepared_files.insert(
        0,
        (
            "audio",
            (
                audio.filename or "speech.webm",
                audio_content,
                audio.content_type or "application/octet-stream",
            ),
        ),
    )
    url = _get_colab_url(COLAB_SPEECH_PATH)

    try:
        async with httpx.AsyncClient(timeout=600, follow_redirects=True) as client:
            response = await client.post(
                url,
                data={"message": message, "speaker_mode": speaker_mode},
                files=prepared_files,
            )
            if not response.is_success:
                detail = await _route_failure_detail(
                    client,
                    response,
                    urlsplit(url).path,
                    "SPEECH_PATH",
                )
                raise HTTPException(status_code=502, detail=detail)
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=504,
            detail="The Colab Speech service timed out. Check the Colab server and ngrok tunnel.",
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail="The backend cannot reach the Colab Speech service. Check the ngrok URL and make sure the tunnel is active.",
        ) from exc

    if not response.content or not response.headers.get("content-type", "").startswith(
        "audio/"
    ):
        raise HTTPException(
            status_code=502,
            detail="The Colab Speech service did not return an audio file.",
        )

    encoded_text = response.headers.get("x-bot-text-b64")
    if not encoded_text:
        raise HTTPException(
            status_code=502,
            detail="The Colab Speech response is missing the X-Bot-Text-B64 header.",
        )

    try:
        bot_text = base64.b64decode(encoded_text, validate=True).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError) as exc:
        raise HTTPException(
            status_code=502,
            detail="The Colab Speech X-Bot-Text-B64 header is not valid UTF-8 base64 text.",
        ) from exc

    return response.content, bot_text


async def set_sts_speaker_with_colab(speaker_version: str):
    if not COLAB_URL:
        raise HTTPException(
            status_code=500,
            detail="COLAB_URL is not configured in backend/.env.",
        )

    url = _get_colab_url(COLAB_STS_MODE_PATH)
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            response = await client.post(
                url,
                json={"speaker_version": speaker_version},
            )
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=504,
            detail="The Colab sts_mode service timed out.",
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail="The backend cannot reach the Colab sts_mode service.",
        ) from exc

    if not response.is_success:
        try:
            result = response.json()
        except ValueError:
            result = {}
        raise HTTPException(
            status_code=502,
            detail=result.get("detail")
            if isinstance(result, dict) and isinstance(result.get("detail"), str)
            else f"The Colab sts_mode service returned HTTP {response.status_code}.",
        )

    try:
        return response.json()
    except ValueError:
        return {"status": "ok"}