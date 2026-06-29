import React from "react";
import {GameAudioControls} from "../lib/useGameAudio";
import {useI18n} from "../lib/i18n";

function SpeakerIcon(props: { muted: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      {props.muted ? (
        <>
          <path d="M17 9l4 4" />
          <path d="M21 9l-4 4" />
        </>
      ) : (
        <>
          <path d="M16 8c1.2 1 1.8 2.3 1.8 4s-.6 3-1.8 4" />
          <path d="M18.5 5.5c2.1 1.8 3.2 4 3.2 6.5s-1.1 4.7-3.2 6.5" />
        </>
      )}
    </svg>
  );
}

export default function GameAudioToggle(props: {
  audio: GameAudioControls;
}) {
  const {audio} = props;
  const {t} = useI18n();
  return (
    <button
      className={audio.enabled ? 'game-audio-toggle active' : 'game-audio-toggle'}
      type="button"
      onClick={audio.toggle}
      title={audio.enabled ? t('soundOff') : t('soundOn')}
      aria-label={audio.enabled ? t('soundOff') : t('soundOn')}
    >
      <SpeakerIcon muted={!audio.enabled} />
    </button>
  );
}
