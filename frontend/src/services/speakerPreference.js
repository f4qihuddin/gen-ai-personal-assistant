export const DEFAULT_SPEAKER_VERSION = "v2/en_speaker_6";
export const ACTIVE_SPEAKER_STORAGE_KEY = "activeBarkSpeakerVersion";
export const ACTIVE_SPEAKER_EVENT = "active-bark-speaker-change";

export function getActiveSpeakerVersion() {
  return (
    localStorage.getItem(ACTIVE_SPEAKER_STORAGE_KEY) ||
    DEFAULT_SPEAKER_VERSION
  );
}

export function setActiveSpeakerVersion(speakerVersion) {
  localStorage.setItem(ACTIVE_SPEAKER_STORAGE_KEY, speakerVersion);
  window.dispatchEvent(
    new CustomEvent(ACTIVE_SPEAKER_EVENT, { detail: speakerVersion }),
  );
}
