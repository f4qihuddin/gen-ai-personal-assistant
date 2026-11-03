import React, { useMemo, useState } from "react";
import barkSpeakers from "../bark_speakers.json";
import {
  getActiveSpeakerVersion,
  setActiveSpeakerVersion,
  ACTIVE_SPEAKER_EVENT,
} from "../services/speakerPreference.js";

const audioFiles = import.meta.glob("../audio/*.mp3", {
  eager: true,
  query: "?url",
  import: "default",
});

const speakers = Object.entries(barkSpeakers).map(([name, values]) => {
  const [version, language, voice, soundEffect, audioPath] = values;
  const fileName = audioPath.split("/").pop();
  return {
    name,
    version,
    language,
    voice,
    soundEffect,
    audioUrl: audioFiles[`../audio/${fileName}`] || "",
  };
});

const uniqueOptions = (key) => [...new Set(speakers.map((speaker) => speaker[key]))];

function SpeakerLibrary() {
  const languages = useMemo(() => uniqueOptions("language"), []);
  const voices = useMemo(() => uniqueOptions("voice"), []);
  const soundEffects = useMemo(() => uniqueOptions("soundEffect"), []);
  const [selectedLanguages, setSelectedLanguages] = useState(languages);
  const [selectedVoices, setSelectedVoices] = useState(voices);
  const [selectedSoundEffects, setSelectedSoundEffects] = useState(soundEffects);
  const [activeSpeaker, setActiveSpeaker] = useState(() => {
    const activeVersion = getActiveSpeakerVersion();
    return speakers.find((speaker) => speaker.version === activeVersion) || null;
  });
  const [speakerError, setSpeakerError] = useState("");

  React.useEffect(() => {
    const handleSpeakerChange = (event) => {
      const speaker = speakers.find(
        (candidate) => candidate.version === event.detail,
      );
      setActiveSpeaker(speaker || null);
    };
    window.addEventListener(ACTIVE_SPEAKER_EVENT, handleSpeakerChange);
    return () =>
      window.removeEventListener(ACTIVE_SPEAKER_EVENT, handleSpeakerChange);
  }, []);

  const toggleOption = (option, selectedOptions, setSelectedOptions) => {
    setSelectedOptions(
      selectedOptions.includes(option)
        ? selectedOptions.filter((selectedOption) => selectedOption !== option)
        : [...selectedOptions, option],
    );
  };

  const toggleAll = (options, selectedOptions, setSelectedOptions) => {
    setSelectedOptions(
      selectedOptions.length === options.length ? [] : [...options],
    );
  };

  const renderOptions = (
    options,
    selectedOptions,
    setSelectedOptions,
  ) => (
    <>
      <button
        type="button"
        className={`filter-item-button ${
          selectedOptions.length === options.length ? "active" : ""
        }`}
        aria-pressed={selectedOptions.length === options.length}
        onClick={() => toggleAll(options, selectedOptions, setSelectedOptions)}
      >
        All
      </button>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={`filter-item-button ${
            selectedOptions.includes(option) ? "active" : ""
          }`}
          aria-pressed={selectedOptions.includes(option)}
          onClick={() =>
            toggleOption(option, selectedOptions, setSelectedOptions)
          }
        >
          {option}
        </button>
      ))}
    </>
  );

  const filteredSpeakers = speakers.filter(
    (speaker) =>
      selectedLanguages.includes(speaker.language) &&
      selectedVoices.includes(speaker.voice) &&
      selectedSoundEffects.includes(speaker.soundEffect),
  );

  const selectSpeaker = (speaker) => {
    if (activeSpeaker?.version === speaker.version) return;
    setSpeakerError("");
    setActiveSpeaker(speaker);
    setActiveSpeakerVersion(speaker.version);
  };

  return (
    <div className="speaker-library">
      <p className="large-text-semibold">Speaker library</p>
      <div className="speaker-library-mainview">
        <div className="filter-speakers">
          <p className="larger-medium-text-semibold">Filter</p>
          <p className="medium-text-semibold">Languages</p>
          <div className="item-list-container">
            {renderOptions(
              languages,
              selectedLanguages,
              setSelectedLanguages,
            )}
          </div>
          <p className="medium-text-semibold">Voices</p>
          <div className="item-list-container">
            {renderOptions(voices, selectedVoices, setSelectedVoices)}
          </div>
          <p className="medium-text-semibold">Sound Effects</p>
          <div className="item-list-container">
            {renderOptions(
              soundEffects,
              selectedSoundEffects,
              setSelectedSoundEffects,
            )}
          </div>
        </div>
        <div className="speaker-list">
          <div className="speaker-list-header">
            <span>{filteredSpeakers.length} voice{filteredSpeakers.length === 1 ? "" : "s"}</span>
          </div>
          {speakerError && <p className="speaker-error" role="alert">{speakerError}</p>}
          {filteredSpeakers.map((speaker) => (
            <article className="speaker-card" key={speaker.version}>
              <div className="speaker-card-content">
                <div className="speaker-card-name">
                  <strong>{speaker.version}</strong>
                </div>
                <div className="speaker-meta">
                  <span>{speaker.language}</span>
                  <span>{speaker.voice}</span>
                  {speaker.soundEffect !== "None" && <span>{speaker.soundEffect}</span>}
                </div>
              </div>
              <button
                type="button"
                className={`speaker-toggle ${
                  activeSpeaker?.version === speaker.version ? "active" : ""
                }`}
                aria-label={`Select ${speaker.name}`}
                aria-pressed={activeSpeaker?.version === speaker.version}
                onClick={() => selectSpeaker(speaker)}
              >
                <span />
              </button>
              <audio controls preload="metadata" src={speaker.audioUrl}>
                Your browser does not support the audio player.
              </audio>
            </article>
          ))}
          {!filteredSpeakers.length && (
            <p className="speaker-empty">No voices match the selected filters.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default SpeakerLibrary;
