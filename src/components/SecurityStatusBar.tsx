import React, {useEffect, useMemo, useRef, useState} from "react";
import {GameRoomStatus} from "../lib/GameRoom";
import {GameAudioControls} from "../lib/useGameAudio";
import {useSecurityStatus} from "../lib/useSecurityStatus";
import {RiskLevel, useRoomRisk} from "../lib/peerRisk";
import {TranslationKey, useI18n} from "../lib/i18n";
import {useWorkerRoomState} from "../lib/useWorkerRoomState";
import {TableId} from "../lib/setup";

function statusCopy(peerState: GameRoomStatus): TranslationKey {
  switch (peerState) {
    case 'NotReady':
      return 'connecting';
    case 'PeerServerConnected':
      return 'relayLinked';
    case 'HostConnected':
      return 'roomLinked';
    case 'Closed':
      return 'closed';
  }
}

function relayCopy(relayHealth: ReturnType<typeof useSecurityStatus>['relayHealth']) {
  switch (relayHealth) {
    case 'online':
      return {key: 'peerToPeer', tone: 'good'};
    case 'not-configured':
      return {key: 'peerToPeer', tone: 'good'};
    case 'checking':
      return {key: 'checking', tone: 'warn'};
    case 'offline':
      return {key: 'limited', tone: 'warn'};
  }
}

function phaseCopy(phase: ReturnType<typeof useSecurityStatus>['phase']): {title: TranslationKey; subtitle: TranslationKey} {
  switch (phase) {
    case 'waiting':
      return {title: 'waiting', subtitle: 'waiting'};
    case 'shuffle':
      return {title: 'shuffle', subtitle: 'shuffle'};
    case 'lock':
      return {title: 'locking', subtitle: 'locking'};
    case 'finalizing':
      return {title: 'sealing', subtitle: 'sealing'};
    case 'ready':
      return {title: 'live', subtitle: 'live'};
    case 'sealed':
      return {title: 'sealed', subtitle: 'sealed'};
  }
}

function SecurityIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M12 3l7 3v5c0 4.6-2.9 8.5-7 10-4.1-1.5-7-5.4-7-10V6l7-3z" />
      <path d="M9 12l2 2 4-5" />
    </svg>
  );
}

function collusionRiskCopy(level: RiskLevel): {key: TranslationKey; tone: 'good' | 'warn' | 'danger'} {
  switch (level) {
    case 'low':
      return {key: 'riskLow', tone: 'good'};
    case 'watch':
      return {key: 'riskMedium', tone: 'warn'};
    case 'high':
    case 'critical':
      return {key: 'riskHigh', tone: 'danger'};
  }
}

export default function SecurityStatusBar(props: {
  peerState: GameRoomStatus;
  playerId: string | undefined;
  members: string[];
  players: string[] | undefined;
  round: number | undefined;
  seriesProgress: {
    current: number;
    total: number;
    complete: boolean;
  };
  currentRoundFinished: boolean;
  boardCardsCount: number;
  whoseTurn: string | undefined;
  audio: GameAudioControls;
}) {
  const {t} = useI18n();
  const {
    peerState,
    playerId,
    members,
    players,
    round,
    seriesProgress,
    currentRoundFinished,
    boardCardsCount,
    whoseTurn,
    audio,
  } = props;
  const security = useSecurityStatus({
    peerState,
    members,
    players,
    round,
    currentRoundFinished,
  });
  const workerRoomState = useWorkerRoomState(TableId);
  const {roomRisk} = useRoomRisk(playerId, members);
  const [open, setOpen] = useState(false);
  const previous = useRef({
    phase: security.phase,
    boardCardsCount,
    whoseTurn,
    round,
    currentRoundFinished,
  });

  useEffect(() => {
    const prev = previous.current;
    if (round && prev.round !== round) {
      audio.play('shuffle');
    } else if (prev.phase !== 'ready' && security.phase === 'ready') {
      audio.play('ready');
    } else if (prev.boardCardsCount !== boardCardsCount && boardCardsCount > 0) {
      audio.play('card');
    } else if (playerId && prev.whoseTurn !== whoseTurn && whoseTurn === playerId) {
      audio.play('turn');
    } else if (!prev.currentRoundFinished && currentRoundFinished) {
      audio.play('win');
    }
    previous.current = {
      phase: security.phase,
      boardCardsCount,
      whoseTurn,
      round,
      currentRoundFinished,
    };
  }, [audio, boardCardsCount, currentRoundFinished, playerId, round, security.phase, whoseTurn]);

  const progressItems = useMemo(() => [
    {
      key: 'shuffle',
      label: t('shuffle'),
      done: security.stats.shuffleCount,
      total: Math.max(security.participantsCount, 1),
    },
    {
      key: 'lock',
      label: t('lock'),
      done: security.stats.lockCount,
      total: Math.max(security.participantsCount, 1),
    },
    {
      key: 'finalized',
      label: t('seal'),
      done: security.stats.finalizedCount > 0 ? 1 : 0,
      total: 1,
    },
  ], [security.participantsCount, security.stats.finalizedCount, security.stats.lockCount, security.stats.shuffleCount, t]);

  const relay = relayCopy(security.relayHealth);
  const connection = statusCopy(peerState);
  const phase = phaseCopy(security.phase);
  const panelGood = security.connected && (relay.tone === 'good');
  const seriesLabel = seriesProgress.total
    ? `${seriesProgress.current}/${seriesProgress.total}`
    : '-';
  const collusionRisk = collusionRiskCopy(roomRisk.level);
  const workerOpponentCount = workerRoomState
    ? Math.max(
      workerRoomState.activePlayerCount - (workerRoomState.players.some(player => player.peerId === playerId && player.seated) ? 1 : 0),
      0,
    )
    : undefined;

  if (!open) {
    return (
      <button
        className={panelGood ? 'security-shield-button good' : 'security-shield-button warn'}
        type="button"
        onClick={() => setOpen(true)}
        title={t('openSecureTable')}
        aria-label={t('openSecureTable')}
        data-testid="security-shield-button"
      >
        <SecurityIcon />
        <span />
      </button>
    );
  }

  return (
    <aside className="security-status-bar compact" data-testid="security-status-bar" aria-label={t('securityStatus')}>
      <header className="security-status-header">
        <div>
          <strong>{t('secureTable')}</strong>
          <small>{t(phase.subtitle)}</small>
        </div>
        <button
          className="security-icon-button"
          onClick={() => setOpen(false)}
          title={t('collapseSecureTable')}
          aria-label={t('collapseSecureTable')}
          data-testid="security-status-close-button"
          type="button"
        >
          ×
        </button>
      </header>

      <div className={`security-phase security-phase-${security.phase}`}>
        <SecurityIcon />
        <div>
          <strong>{t(phase.title)}</strong>
          <small>{t(connection)}</small>
        </div>
      </div>

      <div className="security-status-grid compact">
        <div className={relay.tone}>
          <span />
          <b>{t(relay.key as TranslationKey)}</b>
        </div>
        <div className={security.connected ? 'good' : 'warn'}>
          <span />
          <b>{t(connection)}</b>
        </div>
        <div className={workerOpponentCount && workerOpponentCount > 0 ? 'good' : 'warn'}>
          <span />
          <b>{workerOpponentCount ?? '-'} {t('opponents')}</b>
        </div>
        <div className={collusionRisk.tone}>
          <span />
          <b>{t('collusionRisk')} {t(collusionRisk.key)}</b>
        </div>
      </div>

      <div className="security-compact-meta">
        <span>{t('hands')} <b>{seriesLabel}</b></span>
        <span>{t('logs')} <b>{security.stats.entriesCount}</b></span>
      </div>

      <div className="security-hash-row">
        <span>{t('hash')}</span>
        <b title={security.stats.shortHash}>{security.stats.shortHash}</b>
      </div>

      <div className="security-progress-list compact">
        {progressItems.map(item => {
          const ratio = Math.max(0, Math.min(1, item.done / item.total));
          return (
            <div
              className="security-progress-card"
              data-progress-key={item.key}
              key={item.key}
              style={{'--progress': `${ratio * 100}%`} as React.CSSProperties}
            >
              <span>{item.label}</span>
              <div className="security-progress-track" aria-hidden="true">
                <i />
              </div>
              <b>{Math.min(item.done, item.total)}/{item.total}</b>
            </div>
          );
        })}
      </div>

      <div className="security-status-actions">
        <button
          type="button"
          onClick={security.verifyLocally}
          disabled={!security.transcript || security.transcript.entries.length === 0}
        >
          {t('verify')}
        </button>
        <button
          type="button"
          onClick={security.downloadTranscript}
          disabled={!security.transcript || security.transcript.entries.length === 0}
        >
          {t('download')}
        </button>
      </div>

      {security.verification !== 'idle' && (
        <p className={security.verification === 'passed' ? 'security-check-good' : 'security-check-bad'}>
          {security.verification === 'passed' ? t('verified') : t('incomplete')}
        </p>
      )}
      {security.clientCidVerification.status === 'verified' && (
        <p className="security-check-good" data-testid="client-cid-verified">
          客户端已锁定到发布 CID / Client pinned to release CID ✓
        </p>
      )}
      {security.clientCidVerification.status === 'mismatch' && (
        <p className="security-check-bad" data-testid="client-cid-mismatch">
          ⚠️ 运行 CID 与发布不符 / Running bundle CID ≠ release CID
        </p>
      )}
      {security.clientCidVerification.status === 'not-pinned' && (
        <p className="security-compact-meta" data-testid="client-cid-not-pinned">
          未从固定 IPFS CID 入口运行 / Not loaded from the pinned IPFS entry
        </p>
      )}
    </aside>
  );
}
