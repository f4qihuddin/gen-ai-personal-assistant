import { useEffect, useRef, useState } from "react";
import ReactMarkdown from 'react-markdown';
import bookIcon from "../assets/book-2-rounded.svg";
import researchIcon from "../assets/manage-search-rounded.svg";
import micIcon from "../assets/round-mic.svg";
import sendIcon from "../assets/round-send.svg";
import summarizeIcon from "../assets/summarize-rounded.svg";
import chatbotLogo from "../assets/chatbot-logo.svg";
import {
  sendRagQuery,
  sendRagSpeechMessage,
  storeDocument,
  sendResearchQuery,
} from "../services/api";
import {
  getActiveSpeakerVersion,
  ACTIVE_SPEAKER_EVENT,
} from "../services/speakerPreference";

function getPreviewKind(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (file.type === "application/pdf" || extension === "pdf") return "pdf";
  if (file.type.startsWith("image/")) return "image";
  if (["txt", "csv"].includes(extension)) return "text";
  return "unsupported";
}

function AgentModeIcon({ mode }) {
  return (
    <img
      aria-hidden="true"
      className="agent-mode-option-icon"
      src={mode === "read" ? bookIcon : researchIcon}
      alt=""
    />
  );
}

function ResearchAgent() {
  const [speakerVersion, setSpeakerVersion] = useState(getActiveSpeakerVersion);
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewText, setPreviewText] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const [zoom, setZoom] = useState(1);
  const [panelSize, setPanelSize] = useState(56);
  const [summarizeExpanded, setSummarizeExpanded] = useState(false);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [storedFiles, setStoredFiles] = useState([]);
  const [uploadError, setUploadError] = useState("");
  const [recording, setRecording] = useState(false);
  const [speechNotice, setSpeechNotice] = useState("");
  const [agentMode, setAgentMode] = useState("read");
  const [agentModeMenuOpen, setAgentModeMenuOpen] = useState(false);
  const fileInputRef = useRef(null);
  const workspaceRef = useRef(null);
  const agentModeRef = useRef(null);
  const messagesEndRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioUrlsRef = useRef([]);
  const audioPlayerRef = useRef(null);
  const isHoldingVoiceRef = useRef(false);

  useEffect(() => {
    const handleSpeakerChange = (event) => setSpeakerVersion(event.detail);
    window.addEventListener(ACTIVE_SPEAKER_EVENT, handleSpeakerChange);
    return () =>
      window.removeEventListener(ACTIVE_SPEAKER_EVENT, handleSpeakerChange);
  }, []);

  useEffect(() => {
    setZoom(1);
    setPreviewText(null);
    setPreviewError("");

    if (!selectedFile) {
      setPreviewUrl("");
      return undefined;
    }

    const previewKind = getPreviewKind(selectedFile);
    if (previewKind === "pdf" || previewKind === "image") {
      const objectUrl = URL.createObjectURL(selectedFile);
      setPreviewUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }

    setPreviewUrl("");
    if (previewKind === "text") {
      let isCurrentFile = true;
      selectedFile
        .text()
        .then((text) => {
          if (isCurrentFile) setPreviewText(text);
        })
        .catch((error) => {
          if (isCurrentFile) {
            setPreviewError(
              error instanceof Error
                ? `The file could not be read: ${error.message}`
                : "The file could not be read.",
            );
          }
        });
      return () => {
        isCurrentFile = false;
      };
    }

    return undefined;
  }, [selectedFile]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (!agentModeMenuOpen) return undefined;

    function handlePointerDown(event) {
      if (!agentModeRef.current?.contains(event.target)) {
        setAgentModeMenuOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") setAgentModeMenuOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [agentModeMenuOpen]);

  useEffect(
    () => () => {
      mediaRecorderRef.current?.stop();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      audioPlayerRef.current?.pause();
      audioUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  async function handleFileUpload(event) {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (selectedFiles.length === 0) return;

    setFiles((currentFiles) => [...currentFiles, ...selectedFiles]);
    setSelectedFile(selectedFiles[selectedFiles.length - 1]);
    setUploadError("");
    setUploading(true);

    try {
      const failures = [];
      for (const file of selectedFiles) {
        try {
          await storeDocument(file);
          setStoredFiles((currentFiles) => [...currentFiles, file]);
        } catch (error) {
          const reason =
            error instanceof Error
              ? error.message
              : "An error occurred while saving the document.";
          failures.push(`${file.name}: ${reason}`);
        }
      }

      if (failures.length > 0) {
        setUploadError(failures.join(" "));
      }
    } finally {
      setUploading(false);
    }
  }

  async function sendPrompt(prompt) {
    if (!selectedFile || !storedFiles.includes(selectedFile) || loading) return;

    const file = selectedFile;
    setMessages((currentMessages) => [
      ...currentMessages,
      { role: "user", content: prompt, attachments: [file.name] },
    ]);
    setLoading(true);
    const startedAt = performance.now();

    try {
      const response = await sendRagQuery(prompt);
      const durationSeconds = Math.round(
        (performance.now() - startedAt) / 1000,
      );
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: "assistant",
          content: response,
          status: `Done in ${durationSeconds} s`,
        },
      ]);
    } catch (error) {
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "An error occurred while sending the message.",
          status: "Failed",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function sendResearchPrompt(prompt) {
    if (loading) return;

    // Add the user's message to the UI
    setMessages((currentMessages) => [
      ...currentMessages,
      { role: "user", content: prompt, attachments: [] },
    ]);

    setLoading(true);
    const startedAt = performance.now();

    try {
      const response = await sendResearchQuery(prompt);
      const durationSeconds = Math.round(
        (performance.now() - startedAt) / 1000,
      );

      // Add the AI agent response to the UI
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: "assistant",
          content: response,
          status: `Done in ${durationSeconds} s`,
        },
      ]);
    } catch (error) {
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: "assistant",
          content:
            error instanceof Error ? error.message : "Failed to process the research.",
          status: "Failed",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function processVoiceMessage(audioBlob) {
    setSpeechNotice("");
    setLoading(true);
    const startedAt = performance.now();

    try {
      const result = await sendRagSpeechMessage(audioBlob, speakerVersion);
      const audioUrl = URL.createObjectURL(result.audio);
      audioUrlsRef.current.push(audioUrl);
      const durationSeconds = Math.round(
        (performance.now() - startedAt) / 1000,
      );

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: "assistant",
          content: result.botText,
          status: `Done in ${durationSeconds} s`,
        },
      ]);

      audioPlayerRef.current?.pause();
      const player = new Audio(audioUrl);
      audioPlayerRef.current = player;
      try {
        await player.play();
      } catch {
        setSpeechNotice(
          "The browser blocked autoplay. Allow autoplay to hear the voice response.",
        );
      }
    } catch (error) {
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "An error occurred while processing the voice message.",
          status: "Failed",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function startVoiceRecording() {
    if (
      mediaRecorderRef.current ||
      recording ||
      loading ||
      uploading ||
      !selectedFile ||
      !storedFiles.includes(selectedFile)
    ) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setSpeechNotice("Voice recording is not supported by this browser.");
      isHoldingVoiceRef.current = false;
      return;
    }

    setSpeechNotice("");
    setRecording(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      if (!isHoldingVoiceRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        setRecording(false);
        return;
      }

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      });

      recorder.addEventListener("stop", () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        if (audioBlob.size > 0) {
          setMessages((currentMessages) => [
            ...currentMessages,
            {
              role: "user",
              content: "Voice message",
              attachments: [selectedFile.name],
            },
          ]);
          void processVoiceMessage(audioBlob);
        } else {
          setSpeechNotice(
            "The recording is empty. Hold the Speech button while speaking.",
          );
        }

        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        setRecording(false);
      });

      recorder.addEventListener("error", () => {
        setSpeechNotice("Terjadi kesalahan saat merekam suara.");
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        setRecording(false);
      });

      recorder.start();
    } catch (error) {
      isHoldingVoiceRef.current = false;
      mediaRecorderRef.current = null;
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      setRecording(false);
      setSpeechNotice(
        error instanceof Error && error.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow microphone access to record audio."
          : "The microphone is unavailable. Check your device and browser permissions.",
      );
    }
  }

  function stopVoiceRecording() {
    isHoldingVoiceRef.current = false;
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }

  function handleVoicePointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (loading || uploading) return;
    event.preventDefault();
    isHoldingVoiceRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    void startVoiceRecording();
  }

  function handleVoiceKeyDown(event) {
    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
      event.preventDefault();
      isHoldingVoiceRef.current = true;
      void startVoiceRecording();
    }
  }

  function handleVoiceKeyUp(event) {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      stopVoiceRecording();
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    const prompt = message.trim();
    if (!prompt || loading) return; 

    setMessage("");

    if (agentMode === "read") {
      // Validasi file hanya diperlukan jika dalam mode 'read'
      if (!selectedFile) return;
      void sendPrompt(prompt); 
    } else {
      // Panggil endpoint CrewAI lokal
      void sendResearchPrompt(prompt);
    }
  }

  function handleSummarize() {
    if (
      loading ||
      uploading ||
      !selectedFile ||
      !storedFiles.includes(selectedFile)
    ) {
      return;
    }
    setSummarizeExpanded(true);
    void sendPrompt(
      "Please summarize this document and explain its key points.",
    );
  }

  function resizePanel(event) {
    if (!workspaceRef.current) return;

    const bounds = workspaceRef.current.getBoundingClientRect();
    const isStacked = window.matchMedia("(max-width: 760px)").matches;
    const position = isStacked
      ? event.clientY - bounds.top
      : event.clientX - bounds.left;
    const dimension = isStacked ? bounds.height : bounds.width;
    const nextSize = (position / dimension) * 100;
    setPanelSize(Math.min(75, Math.max(30, nextSize)));
  }

  function handleResizeKeyDown(event) {
    const isStacked = window.matchMedia("(max-width: 760px)").matches;
    const decreaseKey = isStacked ? "ArrowUp" : "ArrowLeft";
    const increaseKey = isStacked ? "ArrowDown" : "ArrowRight";

    if (event.key === decreaseKey || event.key === increaseKey) {
      event.preventDefault();
      const change = event.key === increaseKey ? 2 : -2;
      setPanelSize((size) => Math.min(75, Math.max(30, size + change)));
    }
  }

  const previewKind = selectedFile ? getPreviewKind(selectedFile) : null;

  return (
    <div className="document">
      <p className="large-text-semibold document-title">Research Agent</p>
      <div className="document-workspace" ref={workspaceRef}>
        <section
          className={`document-panel${previewOpen ? " document-panel--preview" : ""}`}
          style={{ flexBasis: `calc(${panelSize}% - 4px)` }}
          aria-label="Document files and preview"
        >
          {previewOpen && selectedFile ? (
            <div className="preview-file-header">
              <p
                className="larger-medium-text-semibold"
                title={selectedFile.name}
              >
                {selectedFile.name}
              </p>
              <button
                className="preview-close-button"
                type="button"
                aria-label="Close preview and return to files"
                onClick={() => setPreviewOpen(false)}
              >
                ×
              </button>
            </div>
          ) : (
            <>
              <div className="files-container-title">
                <p className="larger-medium-text-semibold">Files</p>
              </div>
              <input
                ref={fileInputRef}
                className="file-input"
                type="file"
                multiple
                aria-label="Choose files to upload"
                onChange={handleFileUpload}
              />
              <button
                className="upload-button"
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                <svg
                  className="medium-logo"
                  viewBox="0 0 35 35"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path
                    d="M26.25 18.9555H18.9583V26.2472C18.9583 26.6339 18.8047 27.0049 18.5312 27.2783C18.2577 27.5518 17.8868 27.7055 17.5 27.7055C17.1132 27.7055 16.7423 27.5518 16.4688 27.2783C16.1953 27.0049 16.0417 26.6339 16.0417 26.2472V18.9555H8.74999C8.36322 18.9555 7.99228 18.8018 7.71879 18.5283C7.4453 18.2549 7.29166 17.8839 7.29166 17.4972C7.29166 17.1104 7.4453 16.7394 7.71879 16.466C7.99228 16.1925 8.36322 16.0388 8.74999 16.0388H16.0417V8.74715C16.0417 8.36038 16.1953 7.98944 16.4688 7.71595C16.7423 7.44246 17.1132 7.28882 17.5 7.28882C17.8868 7.28882 18.2577 7.44246 18.5312 7.71595C18.8047 7.98944 18.9583 8.36038 18.9583 8.74715V16.0388H26.25C26.6368 16.0388 27.0077 16.1925 27.2812 16.466C27.5547 16.7394 27.7083 17.1104 27.7083 17.4972C27.7083 17.8839 27.5547 18.2549 27.2812 18.5283C27.0077 18.8018 26.6368 18.9555 26.25 18.9555Z"
                    fill="#FCFCFB"
                  />
                </svg>
                <span className="medium-text-semibold">
                  {uploading ? "Menyimpan..." : "Upload"}
                </span>
              </button>
              {uploadError && (
                <p className="document-upload-error" role="alert">
                  {uploadError}
                </p>
              )}
              <ul className="files-list" aria-label="Uploaded files">
                {files.map((file, index) => (
                  <li key={`${file.name}-${file.lastModified}-${index}`}>
                    <button
                      className={`file-item${file === selectedFile ? " selected" : ""}`}
                      type="button"
                      aria-pressed={file === selectedFile}
                      onClick={() => {
                        setSelectedFile(file);
                        setPreviewOpen(true);
                      }}
                    >
                      <svg
                        className="file-icon"
                        viewBox="0 0 20 20"
                        role="img"
                        aria-label="File"
                      >
                        <path d="M4 1.5h7l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z" />
                        <path d="M11 1.5v5h5" />
                        <path d="M5.5 12.5h9M5.5 15h9" />
                      </svg>
                      <span className="file-name" title={file.name}>
                        {file.name}
                      </span>
                      {storedFiles.includes(file) && (
                        <span className="file-status">Tersimpan</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {previewOpen && selectedFile && (
            <div className="file-preview" aria-label="File preview">
              <div className="preview-toolbar">
                {selectedFile && (
                  <div
                    className="preview-zoom-controls"
                    aria-label="Preview zoom"
                  >
                    <button
                      type="button"
                      aria-label="Zoom out"
                      disabled={zoom <= 0.5}
                      onClick={() =>
                        setZoom((value) => Math.max(0.5, value - 0.25))
                      }
                    ></button>
                    <span>{Math.round(zoom * 100)}%</span>
                    <button
                      type="button"
                      aria-label="Zoom in"
                      disabled={zoom >= 2.5}
                      onClick={() =>
                        setZoom((value) => Math.min(2.5, value + 0.25))
                      }
                    >
                      +
                    </button>
                  </div>
                )}
                {selectedFile && (
                  <button
                    className={`summarize-button${summarizeExpanded ? " expanded" : ""}`}
                    type="button"
                    aria-label="Summarize document"
                    disabled={
                      loading ||
                      uploading ||
                      !storedFiles.includes(selectedFile)
                    }
                    onClick={handleSummarize}
                  >
                    <img src={summarizeIcon} alt="" />
                    {summarizeExpanded && <span>Summarize</span>}
                  </button>
                )}
              </div>
              <div className="file-preview-scroll">
                {previewError ? (
                  <div className="preview-empty" role="alert">
                    {previewError}
                  </div>
                ) : previewKind === "pdf" && previewUrl ? (
                  <div
                    className="pdf-preview-canvas"
                    style={{
                      width: `${zoom * 100}%`,
                      height: `${zoom * 100}%`,
                    }}
                  >
                    <iframe
                      title={`Preview of ${selectedFile.name}`}
                      src={`${previewUrl}#toolbar=1&navpanes=0`}
                      style={{
                        width: `${100 / zoom}%`,
                        height: `${100 / zoom}%`,
                        transform: `scale(${zoom})`,
                      }}
                    />
                  </div>
                ) : previewKind === "image" && previewUrl ? (
                  <img
                    className="image-preview"
                    src={previewUrl}
                    alt={`Preview of ${selectedFile.name}`}
                    style={{ width: `${zoom * 100}%` }}
                  />
                ) : previewKind === "text" ? (
                  <pre
                    className="text-preview"
                    style={{ fontSize: `${14 * zoom}px` }}
                  >
                    {previewText === null ? "Loading preview..." : previewText}
                  </pre>
                ) : (
                  <div className="preview-empty">
                    Browser preview is unavailable for this file type. The file
                    can still be summarized by the chatbot.
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        <div
          className="document-resizer"
          role="separator"
          tabIndex={0}
          aria-label="Resize document and chat panels"
          aria-orientation={
            window.matchMedia("(max-width: 760px)").matches
              ? "horizontal"
              : "vertical"
          }
          aria-valuemin={30}
          aria-valuemax={75}
          aria-valuenow={Math.round(panelSize)}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            resizePanel(event);
          }}
          onPointerMove={(event) => {
            if (event.buttons === 1) resizePanel(event);
          }}
          onKeyDown={handleResizeKeyDown}
        />

        <section className="document-chat-panel" aria-label="Document chat">
          <div className="document-chat-messages" aria-live="polite">
            {messages.map((chatMessage, index) =>
              chatMessage.role === "assistant" ? (
                <article
                  className="assistant-message"
                  key={`${chatMessage.role}-${index}`}
                >
                  <div className="assistant-message-header">
                    <img className="assistant-avatar" src={chatbotLogo} alt="" aria-hidden="true" />
                    <span className="assistant-name">Chatbot</span>
                    <span
                      className={`assistant-status${
                        chatMessage.status === "Failed"
                          ? " assistant-status--error"
                          : ""
                      }`}
                    >
                      {chatMessage.status}
                    </span>
                  </div>
                  <div className="assistant-message-content">
                    <ReactMarkdown>{chatMessage.content}</ReactMarkdown>
                  </div>
                </article>
              ) : (
                <div
                  className="message-bubble message-bubble--user"
                  key={`${chatMessage.role}-${index}`}
                >
                  {chatMessage.content}
                  <ul className="message-attachments">
                    {chatMessage.attachments.map((fileName) => (
                      <li key={fileName}>{fileName}</li>
                    ))}
                  </ul>
                </div>
              ),
            )}
            {loading && (
              <article
                className="assistant-message"
                aria-label="Chatbot is thinking"
              >
                <div className="assistant-message-header">
                  <img className="assistant-avatar" src={chatbotLogo} alt="" aria-hidden="true" />
                  <span className="assistant-name">Chatbot</span>
                  <span className="assistant-status">Thinking...</span>
                </div>
                <div className="assistant-message-content">
                  <span
                    className="assistant-spinner"
                    role="status"
                    aria-label="Thinking"
                  />
                </div>
              </article>
            )}
            <div ref={messagesEndRef} />
          </div>
          <form className="chat-box document-chat-box" onSubmit={handleSubmit}>
            <div className="chat-composer">
              <textarea
                className="chat-input"
                placeholder="Type here"
                aria-label="Write a message about this document"
                rows={2}
                value={message}
                disabled={
                  loading ||
                  uploading
                }
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    event.currentTarget.form.requestSubmit();
                  }
                }}
              />
              <div className="chat-controls">
                <div className="agent-mode" ref={agentModeRef}>
                  <button
                    className="agent-mode-trigger"
                    type="button"
                    aria-haspopup="true"
                    aria-expanded={agentModeMenuOpen}
                    aria-label={`Agent mode: ${agentMode === "read" ? "Read Mode" : "Research Mode"}`}
                    onClick={() => setAgentModeMenuOpen((isOpen) => !isOpen)}
                  >
                    <AgentModeIcon mode={agentMode} />
                    <span>
                      {agentMode === "read" ? "Read Mode" : "Research Mode"}
                    </span>
                    <svg
                      aria-hidden="true"
                      className="agent-mode-chevron"
                      viewBox="0 0 16 16"
                      fill="none"
                    >
                      <path
                        d="m4 6 4 4 4-4"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  {agentModeMenuOpen && (
                    <div
                      className="agent-mode-menu"
                      role="group"
                      aria-label="Choose agent mode"
                    >
                      {[
                        { id: "read", label: "Read Mode" },
                        { id: "research", label: "Research Mode" },
                      ].map((mode) => (
                        <button
                          key={mode.id}
                          className={`agent-mode-option${agentMode === mode.id ? " is-active" : ""}`}
                          type="button"
                          aria-pressed={agentMode === mode.id}
                          onClick={() => {
                            setAgentMode(mode.id);
                            setAgentModeMenuOpen(false);
                          }}
                        >
                          <AgentModeIcon mode={mode.id} />
                          <span>{mode.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="chat-control-spacer" />
                <div className="send-prompt-container">
                  <div className="voice-control">
                    <div
                      className={`voice-control-pill${
                        recording ? " voice-control-pill--recording" : ""
                      }`}
                    >
                      <button
                        className="voice-button"
                        type="button"
                        aria-label={
                          recording
                            ? "Recording; release to send"
                            : "Hold to record speech"
                        }
                        aria-pressed={recording}
                        disabled={
                          !selectedFile ||
                          !storedFiles.includes(selectedFile) ||
                          loading ||
                          uploading
                        }
                        onPointerDown={handleVoicePointerDown}
                        onPointerUp={stopVoiceRecording}
                        onPointerCancel={stopVoiceRecording}
                        onLostPointerCapture={stopVoiceRecording}
                        onKeyDown={handleVoiceKeyDown}
                        onKeyUp={handleVoiceKeyUp}
                        onBlur={stopVoiceRecording}
                      >
                        <img alt="" src={micIcon} />
                        <span>{recording ? "Recording..." : "Speech"}</span>
                      </button>
                    </div>
                  </div>
                  <button
                    className="chat-icon-button send-button"
                    type="submit"
                    aria-label="Send message"
                    disabled={
                      loading ||
                      uploading ||
                      !message.trim()
                    }
                  >
                    <img alt="" src={sendIcon} />
                  </button>
                </div>
              </div>
            </div>
            <p
              className={`chat-notice${speechNotice ? " chat-notice--visible" : ""}`}
              role="status"
            >
              {speechNotice ||
                (recording
                  ? "Release the Speech button to send the recording."
                  : "")}
            </p>
          </form>
        </section>
      </div>
    </div>
  );
}

export default ResearchAgent;
