import React, {useEffect, useState} from "react";
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

  if (!props.visible) {
    return null;
  }

  // 洗牌指示：从原来的全屏遮罩改成右上角一张小卡片（一副小牌在轻轻洗动 + 进度条 + x/n），
  // 不再盖住牌桌、不打断节奏。玩家仍能清楚看到"正在多方加密洗牌、进度到哪了"，只是很小。
  const total = Math.max(props.participants.length, 1);
  const overlay = (
    <div className="shuffle-overlay shuffle-toast" role="status" aria-live="polite" data-testid="shuffle-overlay">
      <div className="shuffle-card" title={t('shuffleOverlayProof')}>
        <span className="shuffle-badge" aria-hidden="true">
          <i /><i /><i />
        </span>
        <div className="shuffle-card-body">
          <div className="shuffle-card-titles">
            <strong>{t('shuffleOverlayTitle')}</strong>
            <small>{t('shuffleOverlayCurrent', {player: activeName})}</small>
          </div>
          <div className="shuffle-progress-track" aria-hidden="true">
            <i style={{'--progress': `${progress}%`} as React.CSSProperties} />
          </div>
          <div className="shuffle-card-meta">
            <span className="shuffle-kicker">{t('shuffleOverlayKicker')}</span>
            <span className="shuffle-count">{completed.size}/{total}</span>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
