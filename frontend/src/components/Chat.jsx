import { useEffect, useRef, useState } from "react";
import ReactMarkdown from 'react-markdown';
import plusIcon from "../assets/round-plus.svg";
import micIcon from "../assets/round-mic.svg";
import sendIcon from "../assets/round-send.svg";
import chatbotLogo from "../assets/chatbot-logo.svg";
import { sendChatMessage, sendSpeechMessage } from "../services/api";
import {
  getActiveSpeakerVersion,
  ACTIVE_SPEAKER_EVENT,
} from "../services/speakerPreference";

const FEATURE_TEMPLATES = {
  casualChat:
    "Hello! I'm ready to chat with you. Write anything you'd like to discuss.",
  readDocs:
    "Upload a PDF, DOCX, TXT, CSV, or XLSX document using the + button, then tell me what information you're looking for.",
  speech:
    "Press and hold the Speech button to talk. Release it to send the message; the chatbot will reply with text and voice.",
};

function Chat() {
  const [speakerVersion, setSpeakerVersion] = useState(getActiveSpeakerVersion);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState("");
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioUrlsRef = useRef([]);
  const audioPlayerRef = useRef(null);
  const isHoldingVoiceRef = useRef(false);
  const composerRef = useRef({ message: "", attachments: [] });

  useEffect(() => {
    const handleSpeakerChange = (event) => setSpeakerVersion(event.detail);
    window.addEventListener(ACTIVE_SPEAKER_EVENT, handleSpeakerChange);
    return () =>
      window.removeEventListener(ACTIVE_SPEAKER_EVENT, handleSpeakerChange);
  }, []);

  useEffect(() => {
    composerRef.current = { message, attachments };
  }, [message, attachments]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(
    () => () => {
      mediaRecorderRef.current?.stop();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      audioPlayerRef.current?.pause();
      audioUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  async function handleSubmit(event) {
    event.preventDefault();

    const text = message.trim();
    if ((!text && attachments.length === 0) || loading) return;

    const files = [...attachments];
    const prompt =
      text ||
      (files.length
        ? "Please analyze the attached document and summarize its important information."
        : "");
    const userMessage = {
      role: "user",
      content: prompt,
      attachments: files.map((file) => file.name),
    };

    setMessages((prev) => [...prev, userMessage]);

    setMessage("");
    setAttachments([]);

    const startedAt = performance.now();
    setLoading(true);
    try {
      const result = await sendChatMessage(prompt, files);
      const durationSeconds = Math.round(
        (performance.now() - startedAt) / 1000,
      );

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.response,
          status: `Done in ${durationSeconds} s`,
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          status: "Failed",
          content:
            error instanceof Error
              ? error.message
              : "An error occurred while sending the message.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleFilesSelected(event) {
    const selectedFiles = Array.from(event.target.files ?? []);
    if (selectedFiles.length > 0) {
      setAttachments((prev) => [...prev, ...selectedFiles]);
      setNotice("");
    }
    event.target.value = "";
  }

  async function startVoiceRecording() {
    if (mediaRecorderRef.current || recording || loading) return;

    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setNotice("Voice recording is not supported by this browser.");
      isHoldingVoiceRef.current = false;
      return;
    }

    setNotice("");
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
          const { message: voicePrompt, attachments: voiceAttachments } =
            composerRef.current;
          const prompt = voicePrompt.trim();
          setMessages((prev) => [
            ...prev,
            {
              role: "user",
              content: prompt ? `${prompt}\n\nVoice message` : "Voice message",
              attachments: voiceAttachments.map((file) => file.name),
            },
          ]);
          setMessage("");
          setAttachments([]);
          void processVoiceMessage(audioBlob, prompt, voiceAttachments);
        } else {
          setNotice("The recording is empty. Hold the Speech button while speaking.");
        }

        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        setRecording(false);
      });

      recorder.addEventListener("error", () => {
        setNotice("An error occurred while recording audio.");
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
      setNotice(
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

  async function processVoiceMessage(audioBlob, prompt, files) {
    setNotice("");
    setLoading(true);
    const startedAt = performance.now();

    try {
      const result = await sendSpeechMessage(
        audioBlob,
        files,
        prompt,
        speakerVersion,
      );
      const audioUrl = URL.createObjectURL(result.audio);
      audioUrlsRef.current.push(audioUrl);
      const durationSeconds = Math.round(
        (performance.now() - startedAt) / 1000,
      );

      setMessages((prev) => [
        ...prev,
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
        setNotice(
          "The browser blocked autoplay. Allow autoplay to hear the voice response.",
        );
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          status: "Failed",
          content:
            error instanceof Error
              ? error.message
              : "An error occurred while processing the voice message.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleVoicePointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (loading) return;
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

  function handleMessageKeyDown(event) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form.requestSubmit();
    }
  }

  function handleFeatureClick(template) {
    if (loading) return;

    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: template,
        status: "Template",
      },
    ]);
  }

  const hasConversation = messages.length > 0;

  return (
    <div className="conversation-area">
      {!hasConversation ? (
        <div className="greeting">
          <p className="extra-large-text-semibold">
            {"Greetings!"}
            <br />
            {"What we'll do today?"}
          </p>
          <div className="feature-container">
            <button
              className="feature"
              type="button"
              onClick={() => handleFeatureClick(FEATURE_TEMPLATES.casualChat)}
            >
              <p className="medium-text-semibold">Casual Chat</p>
              <svg
                className="large-logo"
                viewBox="0 0 80 80"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M66.6667 6.66663H13.3333C9.66666 6.66663 6.69999 9.66663 6.69999 13.3333L6.66666 73.3333L20 60H66.6667C70.3333 60 73.3333 57 73.3333 53.3333V13.3333C73.3333 9.66663 70.3333 6.66663 66.6667 6.66663ZM23.3333 30H56.6667C58.5 30 60 31.5 60 33.3333C60 35.1666 58.5 36.6666 56.6667 36.6666H23.3333C21.5 36.6666 20 35.1666 20 33.3333C20 31.5 21.5 30 23.3333 30ZM43.3333 46.6666H23.3333C21.5 46.6666 20 45.1666 20 43.3333C20 41.5 21.5 40 23.3333 40H43.3333C45.1667 40 46.6667 41.5 46.6667 43.3333C46.6667 45.1666 45.1667 46.6666 43.3333 46.6666ZM56.6667 26.6666H23.3333C21.5 26.6666 20 25.1666 20 23.3333C20 21.5 21.5 20 23.3333 20H56.6667C58.5 20 60 21.5 60 23.3333C60 25.1666 58.5 26.6666 56.6667 26.6666Z"
                  fill="#FCFCFB"
                />
              </svg>
            </button>
            <button
              className="feature"
              type="button"
              onClick={() => handleFeatureClick(FEATURE_TEMPLATES.readDocs)}
            >
              <p className="medium-text-semibold">Read Docs</p>
              <svg
                className="large-logo"
                viewBox="0 0 80 80"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M10 20C8.16669 20 6.66669 18.5 6.66669 16.6667V6.66671C6.66669 4.83337 8.16669 3.33337 10 3.33337H20C21.8334 3.33337 23.3334 4.83337 23.3334 6.66671C23.3334 8.50004 21.8334 10 20 10H13.3334V16.6667C13.3334 18.5 11.8334 20 10 20ZM56.6667 6.66671C56.6667 8.50004 58.1667 10 60 10H66.6667V16.6667C66.6667 18.5 68.1667 20 70 20C71.8334 20 73.3334 18.5 73.3334 16.6667V6.66671C73.3334 4.83337 71.8334 3.33337 70 3.33337H60C58.1667 3.33337 56.6667 4.83337 56.6667 6.66671ZM10 60C8.16669 60 6.66669 61.5 6.66669 63.3334V73.3334C6.66669 75.1667 8.16669 76.6667 10 76.6667H20C21.8334 76.6667 23.3334 75.1667 23.3334 73.3334C23.3334 71.5 21.8334 70 20 70H13.3334V63.3334C13.3334 61.5 11.8334 60 10 60ZM56.6667 73.3334C56.6667 75.1667 58.1667 76.6667 60 76.6667H70C71.8334 76.6667 73.3334 75.1667 73.3334 73.3334V63.3334C73.3334 61.5 71.8334 60 70 60C68.1667 60 66.6667 61.5 66.6667 63.3334V70H60C58.1667 70 56.6667 71.5 56.6667 73.3334ZM63.3334 60C63.3334 63.6667 60.3334 66.6667 56.6667 66.6667H23.3334C19.6667 66.6667 16.6667 63.6667 16.6667 60V20C16.6667 16.3334 19.6667 13.3334 23.3334 13.3334H56.6667C60.3334 13.3334 63.3334 16.3334 63.3334 20V60ZM30 30C30 31.8334 31.5 33.3334 33.3334 33.3334H46.6667C48.5 33.3334 50 31.8334 50 30C50 28.1667 48.5 26.6667 46.6667 26.6667H33.3334C31.5 26.6667 30 28.1667 30 30ZM30 40C30 41.8334 31.5 43.3334 33.3334 43.3334H46.6667C48.5 43.3334 50 41.8334 50 40C50 38.1667 48.5 36.6667 46.6667 36.6667H33.3334C31.5 36.6667 30 38.1667 30 40ZM30 50C30 51.8334 31.5 53.3334 33.3334 53.3334H46.6667C48.5 53.3334 50 51.8334 50 50C50 48.1667 48.5 46.6667 46.6667 46.6667H33.3334C31.5 46.6667 30 48.1667 30 50Z"
                  fill="#FCFCFB"
                />
              </svg>
            </button>
            <button
              className="feature"
              type="button"
              onClick={() => handleFeatureClick(FEATURE_TEMPLATES.speech)}
            >
              <p className="medium-text-semibold">Speech</p>
              <svg
                viewBox="0 0 80 80"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M33.3333 43.3333C40.6971 43.3333 46.6667 37.3638 46.6667 30C46.6667 22.6362 40.6971 16.6666 33.3333 16.6666C25.9695 16.6666 20 22.6362 20 30C20 37.3638 25.9695 43.3333 33.3333 43.3333Z"
                  fill="#FCFCFB"
                />
                <path
                  d="M54.6334 51.8667C49.0334 49 41.7667 46.6667 33.3334 46.6667C24.9001 46.6667 17.6334 49 12.0334 51.8667C10.4069 52.7044 9.04439 53.9764 8.09705 55.5416C7.14971 57.1068 6.65462 58.9038 6.66672 60.7333V63.3333C6.66672 67 9.66672 70 13.3334 70H53.3334C57.0001 70 60.0001 67 60.0001 63.3333V60.7333C60.0001 57 57.9667 53.5667 54.6334 51.8667ZM70.3667 6.16666C70.0768 5.79098 69.7097 5.48176 69.2902 5.2598C68.8708 5.03784 68.4086 4.90829 67.9349 4.87987C67.4612 4.85144 66.9869 4.92481 66.5439 5.09502C66.1009 5.26523 65.6995 5.52834 65.3667 5.86666C64.2001 7.03332 64.0667 8.89999 65.0667 10.2C68.9667 15.2 73.8667 27.6333 65.0667 38.9C64.0667 40.2 64.2001 42.0667 65.3667 43.2333C66.8001 44.6667 69.1334 44.5 70.3667 42.9333C75.3667 36.5 81.5334 20.5333 70.3667 6.16666ZM61.0334 16.1333C60.7746 15.6911 60.4183 15.3137 59.9916 15.03C59.5649 14.7463 59.0791 14.5637 58.5711 14.4962C58.0632 14.4287 57.5465 14.478 57.0605 14.6404C56.5745 14.8028 56.132 15.074 55.7667 15.4333C54.6667 16.5333 54.5667 18.2333 55.3334 19.6C56.1667 21.0667 57.8001 25.2333 55.3001 29.5667C54.5334 30.9 54.6667 32.5667 55.7667 33.6333C57.3334 35.2 59.9334 34.8 61.0334 32.9C64.9001 26.2667 62.9667 19.5 61.0334 16.1333Z"
                  fill="#FCFCFB"
                />
              </svg>
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="chat-header">
            <p className="large-text-semibold">Chat</p>
          </div>
          <div className="messages" aria-live="polite">
            {messages.map((message, index) =>
              message.role === "assistant" ? (
                <article
                  className="assistant-message"
                  key={`${message.role}-${index}`}
                >
                  <div className="assistant-message-header">
                    <img className="assistant-avatar" src={chatbotLogo} alt="" aria-hidden="true" />
                    <span className="assistant-name">Chatbot</span>
                    <span
                      className={`assistant-status${
                        message.status === "Failed"
                          ? " assistant-status--error"
                          : ""
                      }`}
                    >
                      {message.status ?? "Done"}
                    </span>
                  </div>
                  <div className="assistant-message-content">
                    <ReactMarkdown>{message.content}</ReactMarkdown>
                    {message.attachments?.length > 0 && (
                      <ul className="message-attachments">
                        {message.attachments.map((fileName, fileIndex) => (
                          <li key={`${fileName}-${fileIndex}`}>{fileName}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </article>
              ) : (
                <div
                  className="message-bubble message-bubble--user"
                  key={`${message.role}-${index}`}
                >
                  {message.content}
                  {message.attachments?.length > 0 && (
                    <ul className="message-attachments">
                      {message.attachments.map((fileName, fileIndex) => (
                        <li key={`${fileName}-${fileIndex}`}>{fileName}</li>
                      ))}
                    </ul>
                  )}
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
        </>
      )}
      <form className="chat-box" onSubmit={handleSubmit}>
        {attachments.length > 0 && (
          <ul className="attachment-list" aria-label="Selected attachments">
            {attachments.map((file, index) => (
              <li className="attachment-chip" key={`${file.name}-${index}`}>
                <span>{file.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() =>
                    setAttachments((prev) =>
                      prev.filter((_, fileIndex) => fileIndex !== index),
                    )
                  }
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="chat-composer">
          <textarea
            className="chat-input"
            placeholder="Type here"
            aria-label="Write a message"
            rows={2}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={handleMessageKeyDown}
          />
          <div className="chat-controls">
            <button
              className="chat-icon-button attachment-button"
              type="button"
              aria-label="Add attachment"
              onClick={() => fileInputRef.current?.click()}
            >
              <img alt="" src={plusIcon} />
            </button>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              multiple
              accept=".pdf,.docx,.txt,.csv,.xlsx"
              onChange={handleFilesSelected}
              tabIndex={-1}
            />
            <div className="chat-control-spacer" />
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
                loading || (!message.trim() && attachments.length === 0)
              }
            >
              <img alt="" src={sendIcon} />
            </button>
          </div>
        </div>
        <p
          className={`chat-notice${notice ? " chat-notice--visible" : ""}`}
          role="status"
        >
          {notice ||
            (recording ? "Release the Speech button to send the recording." : "")}
        </p>
      </form>
    </div>
  );
}

export default Chat;
