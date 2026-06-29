import React, {useEffect, useMemo, useState} from "react";
import {HandPauseState} from "../lib/texas-holdem/TexasHoldemGameRoom";
import {useI18n} from "../lib/i18n";

function formatClock(totalSeconds: number) {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export default function HandPausePanel(props: {
  pause: HandPauseState;
  playerId?: string;
  names: Map<string, string>;
  onVote: (approve: boolean) => void | Promise<void>;
  // One-click self-recovery: a brief network blip can leave THIS client wrongly
  // stuck on the pause screen even after the other side is back. Reloading
  // re-syncs from the relay and resumes the hand (no data loss — funds/keys live
  // in localStorage). Defaults to a real page reload; injectable for tests.
  onRefresh?: () => void;
}) {
  const {t} = useI18n();
  const nameFor = (playerId: string) => props.names.get(playerId) ?? playerId.slice(0, 8);
  const missingNames = props.pause.missingPlayers.map(nameFor).join(' / ');
  const iAlreadyAgreed = Boolean(props.playerId && props.pause.approvals.includes(props.playerId));

  // Live tick so the unlock countdown updates.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const unlockInSeconds = typeof props.pause.voidUnlockAtMs === 'number'
    ? Math.max(0, Math.ceil((props.pause.voidUnlockAtMs - now) / 1000))
    : 0;
  const voidLocked = unlockInSeconds > 0;

  const voteSummary = useMemo(() => t('pauseVoteSummary', {
    approvals: props.pause.approvals.length,
    voters: props.pause.voters.length,
  }), [props.pause.approvals.length, props.pause.voters.length, t]);

  const handleRefresh = () => {
    if (props.onRefresh) {
      props.onRefresh();
      return;
    }
    try {
      window.location.reload();
    } catch {
      /* jsdom / environments without navigation — no-op */
    }
  };

  return (
    <section className="hand-pause-panel" data-testid="hand-pause-panel" role="status" aria-live="assertive">
      <div className="hand-pause-icon" aria-hidden="true">
        <span />
      </div>
      <div className="hand-pause-content">
        <p className="hand-pause-kicker">{t('handPausedKicker')}</p>
        <h2>{t('handPausedTitle', {players: missingNames})}</h2>
        <p>{t('handPausedWaitCopy')}</p>
        <p className="hand-pause-tip" data-testid="hand-pause-share-tip">{t('handPausedShareTip')}</p>
        <div className="hand-pause-refresh">
          <p className="hand-pause-refresh-hint" data-testid="hand-pause-refresh-hint">{t('handPausedRefreshHint')}</p>
          <button
            type="button"
            className="action-button pause-refresh"
            onClick={handleRefresh}
            data-testid="hand-pause-refresh-button"
          >
            {t('handPausedRefreshButton')}
          </button>
        </div>
        <p className="hand-pause-why">{t('handPausedWhyWait')}</p>
        <p className="hand-pause-outcome" data-testid="hand-pause-outcome">{t('handPausedVoidRule')}</p>
        <div className="hand-pause-meter" aria-label={voteSummary}>
          <span>{voteSummary}</span>
        </div>
        <div className="hand-pause-actions">
          <button
            type="button"
            className={iAlreadyAgreed ? 'action-button pause-vote selected' : 'action-button pause-vote'}
            onClick={() => { if (!voidLocked) void props.onVote(true); }}
            disabled={voidLocked}
            aria-disabled={voidLocked}
            data-testid="void-hand-approve-button"
          >
            {t('voidNowButton')}
            <small>
              {voidLocked
                ? t('handPausedVoidLocked', {time: formatClock(unlockInSeconds)})
                : t('voidNowButtonSmall')}
            </small>
          </button>
        </div>
      </div>
    </section>
  );
}
