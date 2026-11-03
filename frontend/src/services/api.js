const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

const API_URL = API_BASE_URL.replace(/\/+$/, "");

const LOCAL_RESEARCH_URL = "http://localhost:8080";

export async function sendResearchQuery(prompt) {
  const formData = new FormData();
  formData.append("message", prompt);

  // Gunakan LOCAL_RESEARCH_URL di sini, bukan API_URL
  const response = await fetch(`${LOCAL_RESEARCH_URL}/research_agent`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Failed to call the Research Agent.");
  }

  const data = await response.json();
  return data.response;
}

async function readResponseBody(response) {
  const body = await response.text();
  if (!body) return null;

  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function getErrorMessage(result, fallback) {
  if (typeof result === "string" && result) return result;
  if (typeof result?.detail === "string") return result.detail;
  return fallback;
}

export async function storeDocument(file) {
  const formData = new FormData();
  formData.append("file", file, file.name);

  let response;
  try {
    response = await fetch(`${API_URL}/api/store`, {
      method: "POST",
      body: formData,
    });
  } catch {
    throw new Error(
      "Unable to connect to the backend. Check that the backend is running and the API URL is correct.",
    );
  }

  const result = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(
      getErrorMessage(
        result,
        `Failed to save the document (HTTP ${response.status}).`,
      ),
    );
  }
}

export async function sendRagQuery(query) {
  let response;
  try {
    response = await fetch(`${API_URL}/api/rag_text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
  } catch {
    throw new Error(
      "Unable to connect to the backend. Check that the backend is running and the API URL is correct.",
    );
  }

  const result = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(
      getErrorMessage(
        result,
        `RAG request failed (HTTP ${response.status}).`,
      ),
    );
  }

  if (typeof result !== "string") {
    throw new Error("The /rag_text response is not a string.");
  }

  return result;
}

export async function sendChatMessage(message, files = []) {
  const formData = new FormData();
  formData.append("message", message);
  files.forEach((file) => formData.append("files", file, file.name));

  let response;

  try {
    response = await fetch(`${API_URL}/api/chat`, {
      method: "POST",
      body: formData,
    });
  } catch {
    throw new Error(
      "Unable to connect to the backend. Check that the backend is running and the API URL is correct.",
    );
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(
      `The backend returned an invalid response (HTTP ${response.status}).`,
    );
  }

  if (!response.ok) {
    throw new Error(
      typeof result.detail === "string"
        ? result.detail
        : `Chat request failed (HTTP ${response.status}).`,
    );
  }

  if (typeof result.response !== "string") {
    throw new Error("The backend response does not contain the text field 'response'.");
  }

  return result;
}

export async function sendSpeechMessage(
  audio,
  files = [],
  message = "",
  speakerMode = "v2/en_speaker_6",
) {
  const formData = new FormData();
  const extension = audio.type.includes("ogg")
    ? "ogg"
    : audio.type.includes("mp4")
      ? "mp4"
      : "webm";
  formData.append("audio", audio, `speech.${extension}`);
  formData.append("message", message);
  formData.append("speaker_mode", speakerMode);
  files.forEach((file) => formData.append("files", file, file.name));

  let response;

  try {
    response = await fetch(`${API_URL}/api/speech`, {
      method: "POST",
      body: formData,
    });
  } catch {
    throw new Error(
      "Unable to connect to the backend. Check that the backend is running and the API URL is correct.",
    );
  }

  if (!response.ok) {
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(
        `The backend returned an invalid response (HTTP ${response.status}).`,
      );
    }

    throw new Error(
      typeof result.detail === "string"
        ? result.detail
        : `Speech request failed (HTTP ${response.status}).`,
    );
  }

  const encodedBotText = response.headers.get("X-Bot-Text-B64");
  if (!encodedBotText) {
    throw new Error("The Speech response does not include chatbot text.");
  }

  let botText;
  try {
    const binaryText = atob(encodedBotText);
    const bytes = Uint8Array.from(binaryText, (character) =>
      character.charCodeAt(0),
    );
    botText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("The chatbot text in the Speech response is invalid.");
  }

  const replyAudio = await response.blob();
  if (!replyAudio.size || !replyAudio.type.startsWith("audio/")) {
    throw new Error("The Speech response does not contain a valid audio file.");
  }

  return { botText, audio: replyAudio };
}

export async function sendRagSpeechMessage(
  audio,
  speakerMode = "v2/en_speaker_6",
) {
  const formData = new FormData();
  const extension = audio.type.includes("ogg")
    ? "ogg"
    : audio.type.includes("mp4")
      ? "mp4"
      : audio.type.includes("wav")
        ? "wav"
        : "webm";
  formData.append("audio", audio, `rag-speech.${extension}`);
  formData.append("speaker_mode", speakerMode);

  let response;
  try {
    response = await fetch(`${API_URL}/api/rag_speech`, {
      method: "POST",
      body: formData,
    });
  } catch {
    throw new Error(
      "Unable to connect to the backend. Check that the backend is running and the API URL is correct.",
    );
  }

  if (!response.ok) {
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(
        `The backend returned an invalid response (HTTP ${response.status}).`,
      );
    }

    throw new Error(
      typeof result.detail === "string"
        ? result.detail
        : `Speech-to-speech RAG request failed (HTTP ${response.status}).`,
    );
  }

  const encodedBotText = response.headers.get("X-Bot-Text-B64");
  if (!encodedBotText) {
    throw new Error(
      "The speech-to-speech RAG response does not include chatbot text.",
    );
  }

  let botText;
  try {
    const binaryText = atob(encodedBotText);
    const bytes = Uint8Array.from(binaryText, (character) =>
      character.charCodeAt(0),
    );
    botText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(
      "The chatbot text in the speech-to-speech RAG response is invalid.",
    );
  }

  const replyAudio = await response.blob();
  if (!replyAudio.size || !replyAudio.type.startsWith("audio/")) {
    throw new Error(
      "The speech-to-speech RAG response does not contain a valid audio file.",
    );
  }

  return { botText, audio: replyAudio };
}
