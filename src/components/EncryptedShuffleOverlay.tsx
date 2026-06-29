import React, {useEffect, useMemo, useState} from "react";
import {createPortal} from "react-dom";
import {SIGNED_EVENT_KIND, SignedGameEvent} from "../lib/fairness/eventSigning";
import {TranscriptEntry} from "../lib/fairness/transcript";
import {TexasHoldem} from "../lib/setup";
import {useI18n} from "../lib/i18n";

type ShufflePayload = {
  type?: string;
  round?: number;
  player?: string;
  shuffleIndex?: number;
};

function getPayload(entry: TranscriptEntry<unknown>): ShufflePayload | null {
  const wireEvent = entry.wireEvent as ShufflePayload | SignedGameEvent<ShufflePayload>;
  if (!wireEvent || typeof wireEvent !== 'object') {
    return null;
  }
  if ((wireEvent as SignedGameEvent<ShufflePayload>).kind === SIGNED_EVENT_KIND) {
    return (wireEvent as SignedGameEvent<ShufflePayload>).payload;
  }
  return wireEvent as ShufflePayload;
}

function displayName(playerId: string, names: Map<string, string> | undefined, selfId: string | undefined, me: string) {
  return names?.get(playerId) ?? (playerId === selfId ? me : playerId.slice(0, 6));
}

export default function EncryptedShuffleOverlay(props: {
  visible: boolean;
  startedAtMs: number;
  participants: string[];
  names?: Map<string, string>;
  playerId?: string;
}) {
  const {t} = useI18n();
  const [completed, setCompleted] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    if (!props.visible) {
      setCompleted(new Map());
      return;
    }

    const syncFromTranscript = () => {
      const snapshot = TexasHoldem?.getTranscript?.();
      const next = new Map<number, string>();
      for (const entry of snapshot?.entries ?? []) {
        const payload = getPayload(entry);
        const recordedAtMs = Date.parse(entry.recordedAt);
        if (
          payload?.type === 'deck/shuffle'
          && typeof payload.shuffleIndex === 'number'
          && typeof payload.player === 'string'
          && Number.isFinite(recordedAtMs)
          && recordedAtMs >= props.startedAtMs - 750
        ) {
          next.set(payload.shuffleIndex, payload.player);
        }
      }
      setCompleted(next);
    };

    syncFromTranscript();
    TexasHoldem?.listener.on('transcript', syncFromTranscript);
    return () => {
      TexasHoldem?.listener.off('transcript', syncFromTranscript);
    };
  }, [props.startedAtMs, props.visible]);

  const activeIndex = Math.min(completed.size, Math.max(props.participants.length - 1, 0));
  const activePlayer = props.participants[activeIndex];
  const progress = props.participants.length
    ? Math.min(100, Math.round((completed.size / props.participants.length) * 100))
    : 0;

  const activeName = activePlayer
    ? displayName(activePlayer, props.names, props.playerId, t('me'))
    : t('waiting');

  const orbitCards = useMemo(() => Array.from({length: 10}, (_, index) => index), []);

  if (!props.visible) {
    return null;
  }

  const overlay = (
    <div className="shuffle-overlay" role="status" aria-live="polite" data-testid="shuffle-overlay">
      <div className="shuffle-panel">
        <div className="shuffle-visual" aria-hidden="true">
          <div className="shuffle-ring">
            {orbitCards.map(index => (
              <span
                key={index}
                className="shuffle-card-particle"
                style={{'--card-index': index} as React.CSSProperties}
              />
            ))}
            <div className="shuffle-core">
              <span />
              <b>{completed.size}/{Math.max(props.participants.length, 1)}</b>
            </div>
          </div>
        </div>
        <div className="shuffle-copy">
          <span className="shuffle-kicker">{t('shuffleOverlayKicker')}</span>
          <strong>{t('shuffleOverlayTitle')}</strong>
          <p>{t('shuffleOverlayCurrent', {player: activeName})}</p>
          <div className="shuffle-progress-track" aria-hidden="true">
            <i style={{'--progress': `${progress}%`} as React.CSSProperties} />
          </div>
        </div>
        <div className="shuffle-steps" aria-label={t('shuffleOverlaySteps')}>
          {props.participants.map((participant, index) => {
            const done = completed.has(index);
            const active = index === activeIndex && completed.size < props.participants.length;
            return (
              <div
                key={`${participant}-${index}`}
                className={`shuffle-step${done ? ' done' : ''}${active ? ' active' : ''}`}
              >
                <span>{index + 1}</span>
                <b>{displayName(participant, props.names, props.playerId, t('me'))}</b>
                <small>{done ? t('shuffleOverlayDone') : active ? t('shuffleOverlayEncrypting') : t('shuffleOverlayWaiting')}</small>
              </div>
            );
          })}
        </div>
        <small className="shuffle-proof-note">{t('shuffleOverlayProof')}</small>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
