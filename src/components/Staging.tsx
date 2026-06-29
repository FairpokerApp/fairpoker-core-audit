import {
  DEFAULT_AUTO_FOLD_TIMEOUT_SECONDS,
  DEFAULT_BIG_BLIND_AMOUNT,
  DEFAULT_ENCRYPTION_BITS,
  DEFAULT_PLANNED_ROUNDS,
  DEFAULT_SMALL_BLIND_AMOUNT,
  TexasHoldemRoundSettings
} from "../lib/texas-holdem/TexasHoldemGameRoom";
import React, {useEffect, useMemo, useState} from "react";
import {HostId} from "../lib/setup";
import Invitation from "./Invitation";
import {useI18n} from "../lib/i18n";
import PlayerAvatar from "./PlayerAvatar";
import EncryptedShuffleOverlay from "./EncryptedShuffleOverlay";
import NextHandCountdown from "./NextHandCountdown";
import {WorkerRoomState} from "../lib/CloudflareRelayTransport";
import {
  workerConnectionStatus,
  workerRoomHasLiveHand,
  workerRoomRailPlayers,
  workerRoomSeatedPlayers,
  workerRoomTablePlayers,
} from "../lib/useWorkerRoomState";
import {buildCreateTableUrl} from "../lib/tableLobby";

type SeriesProgress = {
  current: number;
  total: number;
  complete: boolean;
};

function parsePositiveIntegerInput(value: string) {
  if (value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.round(parsed);
}

export function buildNewTableUrl(currentHref = window.location.href) {
  return buildCreateTableUrl(currentHref);
}

export default function Staging(props: {
  round: number | undefined;
  playerId: string;
  members: string[];
  players?: string[];
  startGame: (settings?: Partial<TexasHoldemRoundSettings>) => void | Promise<void>;
  /** Client's own "can start" (>=2 seated locally); lets the host start when the worker view is stale. */
  localPlayable?: boolean;
  onRoundSettingsChange?: (settings: TexasHoldemRoundSettings) => void | Promise<void>;
  roundSettings?: TexasHoldemRoundSettings;
  names?: Map<string, string>;
  seriesProgress?: SeriesProgress;
  nextHandAutoStartDelaySeconds?: number;
  shuffleOverlayStartedAt?: number | null;
  shuffleParticipants?: string[];
  roomState?: WorkerRoomState | null;
  /** The host has explicitly ended the series and opened registration for a new one. */
  registrationOpen?: boolean;
  nextHandRecoveryRequested?: boolean;
  returnToTableRequested?: boolean;
  onReturnToTable?: () => void | Promise<void>;
  onNextHandCountdownComplete?: (options?: {manual?: boolean}) => void;
}) {
  const {
    onRoundSettingsChange,
    round,
  } = props;
  const names = props.names ?? new Map<string, string>();
  const {t} = useI18n();

  const workerTablePlayers = useMemo(
    () => (props.roomState ? workerRoomTablePlayers(props.roomState) : []),
    [props.roomState],
  );
  const workerSeatedMembers = useMemo(
    () => (props.roomState ? workerRoomSeatedPlayers(props.roomState) : []),
    [props.roomState],
  );
  const myWorkerState = useMemo(
    () => props.roomState?.players.find(player => player.peerId === props.playerId),
    [props.playerId, props.roomState],
  );
  const needsReturnToTable = Boolean(
    myWorkerState
    && (
      myWorkerState.status === 'timedOut'
      || myWorkerState.status === 'sittingOut'
      || myWorkerState.status === 'offline'
    )
  );
  const needsJoinBattle = Boolean(
    myWorkerState
    && !myWorkerState.seated
    && myWorkerState.status === 'watching'
  );
  // Prefer the worker's view, but fall back to the client's own "can start" so a
  // stale/desynced worker roomState can't hide the start button / next-hand
  // countdown and deadlock the table.
  const enoughMembersToPlay = props.roomState?.playable === true || Boolean(props.localPlayable);
  // When the host has explicitly ended the series and opened registration, the relay
  // may still be reporting the just-finished hand for a beat (the openRegistration
  // event has not round-tripped yet). That stale "live hand" signal must NOT trap the
  // host on "牌局正在进行 / 回到桌上" — registration means there is no live hand by intent.
  const workerHasActiveHand = !props.round && !props.registrationOpen && workerRoomHasLiveHand(props.roomState);
  const railPlayers = useMemo(
    () => workerRoomRailPlayers(props.roomState),
    [props.roomState],
  );
  const [initialFundAmountInput, setInitialFundAmountInput] = useState('100');
  const initialFundAmount = useMemo(() => parsePositiveIntegerInput(initialFundAmountInput), [initialFundAmountInput]);
  const [smallBlindAmountInput, setSmallBlindAmountInput] = useState(String(DEFAULT_SMALL_BLIND_AMOUNT));
  const parsedSmallBlindAmount = useMemo(() => parsePositiveIntegerInput(smallBlindAmountInput), [smallBlindAmountInput]);
  const smallBlindAmount = parsedSmallBlindAmount ?? DEFAULT_SMALL_BLIND_AMOUNT;
  const [bigBlindAmountInput, setBigBlindAmountInput] = useState(String(DEFAULT_BIG_BLIND_AMOUNT));
  const parsedBigBlindAmount = useMemo(() => parsePositiveIntegerInput(bigBlindAmountInput), [bigBlindAmountInput]);
  const bigBlindAmount = parsedBigBlindAmount === undefined
    ? DEFAULT_BIG_BLIND_AMOUNT
    : Math.max(smallBlindAmount + 1, parsedBigBlindAmount);
  const [autoFoldTimeoutInput, setAutoFoldTimeoutInput] = useState(String(DEFAULT_AUTO_FOLD_TIMEOUT_SECONDS));
  const autoFoldTimeoutSeconds = useMemo(() => parsePositiveIntegerInput(autoFoldTimeoutInput), [autoFoldTimeoutInput]);
  const [plannedRoundsInput, setPlannedRoundsInput] = useState(String(DEFAULT_PLANNED_ROUNDS));
  const plannedRounds = useMemo(() => parsePositiveIntegerInput(plannedRoundsInput), [plannedRoundsInput]);
  const [encryptionBits] = useState<number>(DEFAULT_ENCRYPTION_BITS);

  const roundSettings = useMemo<TexasHoldemRoundSettings | null>(() => {
    if (
      initialFundAmount === undefined
      || parsedSmallBlindAmount === undefined
      || parsedBigBlindAmount === undefined
      || autoFoldTimeoutSeconds === undefined
      || plannedRounds === undefined
    ) {
      return null;
    }
    return {
      bits: encryptionBits,
      initialFundAmount,
      smallBlindAmount,
      bigBlindAmount,
      autoFoldTimeoutSeconds,
      plannedRounds,
    };
  }, [
    autoFoldTimeoutSeconds,
    bigBlindAmount,
    encryptionBits,
    initialFundAmount,
    parsedBigBlindAmount,
    parsedSmallBlindAmount,
    plannedRounds,
    smallBlindAmount,
  ]);
  useEffect(() => {
    if (HostId || round || workerHasActiveHand || !onRoundSettingsChange || !roundSettings) {
      return;
    }
    void onRoundSettingsChange(roundSettings);
  }, [onRoundSettingsChange, round, roundSettings, workerHasActiveHand]);
  const visibleRoundSettings = props.roundSettings ?? roundSettings ?? {
    bits: encryptionBits,
    initialFundAmount: initialFundAmount ?? 100,
    smallBlindAmount,
    bigBlindAmount,
    autoFoldTimeoutSeconds: autoFoldTimeoutSeconds ?? DEFAULT_AUTO_FOLD_TIMEOUT_SECONDS,
    plannedRounds: plannedRounds ?? DEFAULT_PLANNED_ROUNDS,
  };
  const gameSettingRows = [
    {label: t('initialChips'), value: `$${visibleRoundSettings.initialFundAmount}`},
    {label: t('smallBlind'), value: `$${visibleRoundSettings.smallBlindAmount ?? DEFAULT_SMALL_BLIND_AMOUNT}`},
    {label: t('bigBlind'), value: `$${visibleRoundSettings.bigBlindAmount ?? DEFAULT_BIG_BLIND_AMOUNT}`},
    {label: t('plannedHands'), value: String(visibleRoundSettings.plannedRounds ?? DEFAULT_PLANNED_ROUNDS)},
    {label: t('autoFold'), value: `${visibleRoundSettings.autoFoldTimeoutSeconds ?? DEFAULT_AUTO_FOLD_TIMEOUT_SECONDS}s`},
  ];

  const restartAtHome = () => {
    window.location.href = buildNewTableUrl();
  };

  const participants = (
    <div className="staging-participants" data-testid="staging-participants" aria-label={t('playersAtTable')}>
      {workerSeatedMembers.map(member => (
        <PlayerAvatar
          key={member}
          playerId={member}
          playerName={names.get(member) ?? (member === props.playerId ? t('me') : member.slice(0, 6))}
        />
      ))}
    </div>
  );
  const railStatusLabel = (status: string, seated: boolean) => {
    if (seated) {
      return t('queuedForNextHand');
    }
    switch (status) {
      case 'timedOut':
        return t('railTimedOut');
      case 'sittingOut':
        return t('railSittingOut');
      case 'offline':
        return t('railOffline');
      default:
        return t('watching');
    }
  };
  const railList = railPlayers.length > 0 ? (
    <div className="staging-rail-list" data-testid="staging-rail-list" aria-label={t('spectatorList')}>
      <strong>{t('spectatorList')}</strong>
      <div>
        {railPlayers.map(player => (
          <div className="staging-rail-item" key={player.peerId}>
            <PlayerAvatar
              playerId={player.peerId}
              playerName={names.get(player.peerId) ?? (player.peerId === props.playerId ? t('me') : player.peerId.slice(0, 6))}
              connectionStatus={workerConnectionStatus(player) ?? 'warn'}
            />
            <span>{railStatusLabel(player.status, player.seated)}</span>
          </div>
        ))}
      </div>
    </div>
  ) : null;
  const joinBattlePanel = needsJoinBattle && props.onReturnToTable ? (
    <div className="staging-status ready staging-join-panel" role="status" aria-live="polite" data-testid="staging-join-panel">
      <strong>{workerHasActiveHand ? t('watchingTitle') : t('joinBattleTitle')}</strong>
      <span>{workerHasActiveHand ? t('watchingCopy') : t('joinBattleCopy')}</span>
      <button
        type="button"
        className="action-button start-button"
        onClick={() => void props.onReturnToTable?.()}
        data-testid="join-battle-button"
      >{workerHasActiveHand ? t('sitBackDown') : t('joinBattle')}</button>
    </div>
  ) : null;
  const returnPanel = needsReturnToTable && props.onReturnToTable ? (
    <div className="staging-status warning staging-return-panel" role="status" aria-live="polite" data-testid="staging-return-panel">
      <strong>{
        myWorkerState?.status === 'timedOut'
          ? t('seatTimedOutTitle')
          : myWorkerState?.status === 'offline'
            ? t('seatOfflineTitle')
            : t('seatLostTitle')
      }</strong>
      <span>
        {props.returnToTableRequested
          ? t('seatReturnPendingCopy')
          : myWorkerState?.status === 'timedOut' || myWorkerState?.status === 'offline'
            ? t('seatTimedOutCopy')
            : t('seatLostCopy')}
      </span>
      <button
        type="button"
        className="action-button start-button"
        onClick={() => void props.onReturnToTable?.()}
        data-testid="return-to-table-button"
        >{props.returnToTableRequested
          ? t('returnToTablePending')
          : myWorkerState?.status === 'timedOut' || myWorkerState?.status === 'offline'
            ? t('sitBackDown')
            : t('returnToTable')}</button>
    </div>
  ) : null;
  const activeHandPanel = workerHasActiveHand && !needsJoinBattle ? (
    <div className="staging-status warning staging-active-hand" role="status" aria-live="polite" data-testid="staging-active-hand">
      <strong>{t('activeHandTitle')}</strong>
      <span>{t('activeHandCopy')}</span>
      {props.onReturnToTable && (
        <button
          type="button"
          className="action-button start-button staging-active-hand-button"
          onClick={() => void props.onReturnToTable?.()}
          data-testid="active-hand-return-button"
        >{props.returnToTableRequested ? t('returnToTablePending') : t('returnToTable')}</button>
      )}
    </div>
  ) : null;

  const shuffleParticipants = useMemo(() => {
    if (props.shuffleParticipants?.length) {
      return props.shuffleParticipants;
    }
    const source = workerTablePlayers;
    if (source.length < 2) {
      return source;
    }
    const offset = (props.round ?? 0) % source.length;
    return [
      ...source.slice(offset),
      ...source.slice(0, offset),
    ];
  }, [props.round, props.shuffleParticipants, workerTablePlayers]);

  const startWithShuffleOverlay = (settings?: Partial<TexasHoldemRoundSettings>) => {
    if (workerHasActiveHand) {
      return;
    }
    // The shuffle animation is driven solely by the real shuffle transcript
    // (props.shuffleOverlayStartedAt from the parent); no optimistic local overlay.
    Promise.resolve(props.startGame(settings)).catch(error => {
      console.error(error);
    });
  };
  const visibleShuffleStartedAt = props.shuffleOverlayStartedAt ?? null;
  const showNextHandCountdown = Boolean(
    props.round
    && enoughMembersToPlay
    && !props.seriesProgress?.complete
    && visibleShuffleStartedAt === null
  );
  const showShuffleOverlay = visibleShuffleStartedAt !== null;

  if (props.seriesProgress?.complete && !props.round) {
    return (
      <div className="staging host staging-complete" data-testid="staging">
        <h4>{t('matchComplete')}</h4>
        <button
          className="action-button start-button"
          onClick={restartAtHome}
          data-testid="new-table-button"
        >{t('newTable')}</button>
      </div>
    );
  }

  if (HostId && !props.round) {
    return (
      <div className="staging staging-waiting" data-testid="staging">
        {workerSeatedMembers.length > 0 && participants}
        {railList}
        {activeHandPanel}
        {joinBattlePanel}
        {enoughMembersToPlay && !props.round && !workerHasActiveHand && (
          <div className="seat-recovery-panel staging-game-settings" role="status" aria-live="polite" data-testid="staging-game-settings">
            <strong>{t('gameSettings')}</strong>
            <div className="staging-settings-grid">
              {gameSettingRows.map(row => (
                <div className="staging-settings-row" key={row.label}>
                  <span>{row.label}</span>
                  <b>{row.value}</b>
                </div>
              ))}
            </div>
          </div>
        )}
        {returnPanel}
        <p>{t('waitingHost')}</p>
        <button
          type="button"
          className="action-button start-button"
          onClick={restartAtHome}
          data-testid="new-table-button"
        >{t('newTable')}</button>
      </div>
    );
  }

  return (
    <div
      className={props.round
        ? `staging host staging-next-hand${props.seriesProgress?.complete ? '' : ' staging-next-hand-countdown-only'}`
        : 'staging host staging-setup'}
      data-testid="staging"
    >
      <EncryptedShuffleOverlay
        visible={showShuffleOverlay}
        startedAtMs={visibleShuffleStartedAt ?? 0}
        participants={shuffleParticipants}
        names={names}
        playerId={props.playerId}
      />
      {
        props.round ? (
          <>
            {props.seriesProgress?.complete ? (
              <>
                {enoughMembersToPlay && participants}
                {railList}
                <Invitation hostPlayerId={props.playerId} />
                <div className="staging-status ready">
                  <strong>{t('matchComplete')}</strong>
                  <span>{t('finalReportGuestCopy')}</span>
                </div>
              </>
            ) : (
              !enoughMembersToPlay && (
                <div className="staging-status warning">
                  <strong>{t('opponentLeftTitle')}</strong>
                  <span>{t('opponentLeftCopy')}</span>
                </div>
              )
            )}
            {showNextHandCountdown && (
              <NextHandCountdown
                delaySeconds={props.nextHandAutoStartDelaySeconds}
                canRecover={Boolean(props.onNextHandCountdownComplete)}
                recoveryRequested={props.nextHandRecoveryRequested}
                onRecover={() => props.onNextHandCountdownComplete?.({manual: true})}
                onComplete={props.onNextHandCountdownComplete}
              />
            )}
          </>
        ) : (
          <>
            <header className="staging-setup-header">
              <div>
                <span className="staging-kicker">{t('secureTable')}</span>
                <h4>{workerHasActiveHand ? t('activeHandTitle') : t('gameSettings')}</h4>
              </div>
              {!workerHasActiveHand && (
                <div className={enoughMembersToPlay ? 'staging-ready-pill ready' : 'staging-ready-pill'}>
                  <span aria-hidden="true" />
                  {enoughMembersToPlay ? t('setupReady') : t('needOneMore')}
                </div>
              )}
            </header>
            {workerSeatedMembers.length > 0 && <div className="staging-player-strip">{participants}</div>}
            {railList}
            {activeHandPanel}
            {joinBattlePanel}
            {returnPanel}
            {!workerHasActiveHand && (
              <>
                <div className="staging-settings-panel">
                  <div className="staging-field-grid compact">
                    <label className="staging-field">
                      <span>{t('smallBlind')}</span>
                      <div className="staging-number-control">
                        <b>$</b>
                        <input
                          type="number"
                          min={1}
                          value={smallBlindAmountInput}
                          onChange={(e) => {
                            setSmallBlindAmountInput(e.target.value);
                            const nextSmallBlind = parsePositiveIntegerInput(e.target.value) ?? DEFAULT_SMALL_BLIND_AMOUNT;
                            const currentBigBlind = parsePositiveIntegerInput(bigBlindAmountInput) ?? DEFAULT_BIG_BLIND_AMOUNT;
                            if (currentBigBlind <= nextSmallBlind) {
                              setBigBlindAmountInput(String(nextSmallBlind + 1));
                            }
                          }}
                          data-testid="sb-input"
                        />
                      </div>
                    </label>
                    <label className="staging-field">
                      <span>{t('bigBlind')}</span>
                      <div className="staging-number-control">
                        <b>$</b>
                        <input
                          type="number"
                          min={smallBlindAmount + 1}
                          value={bigBlindAmountInput}
                          onChange={(e) => setBigBlindAmountInput(e.target.value)}
                          onBlur={() => {
                            if (bigBlindAmount <= smallBlindAmount) {
                              setBigBlindAmountInput(String(smallBlindAmount + 1));
                            }
                          }}
                          data-testid="bb-input"
                        />
                      </div>
                    </label>
                  </div>
                  <div className="staging-field-grid">
                    <label className="staging-field">
                      <span>{t('initialChips')}</span>
                      <div className="staging-number-control">
                        <b>$</b>
                        <input
                          type="number"
                          value={initialFundAmountInput}
                          onChange={(e) => setInitialFundAmountInput(e.target.value)}
                          data-testid="initial-fund-amount-input"
                        />
                      </div>
                    </label>
                    <label className="staging-field">
                      <span>{t('plannedHands')}</span>
                      <div className="staging-number-control plain">
                        <input
                          type="number"
                          min={1}
                          value={plannedRoundsInput}
                          onChange={(e) => setPlannedRoundsInput(e.target.value)}
                          data-testid="planned-rounds-input"
                        />
                      </div>
                    </label>
                    <label className="staging-field">
                      <span>{t('autoFold')}</span>
                      <div className="staging-number-control suffix">
                        <input
                          type="number"
                          min={5}
                          value={autoFoldTimeoutInput}
                          onChange={(e) => setAutoFoldTimeoutInput(e.target.value)}
                          data-testid="auto-fold-timeout-input"
                        />
                        <b>s</b>
                      </div>
                    </label>
                  </div>
                </div>
                <div className="staging-invite-panel">
                  <Invitation hostPlayerId={props.playerId}/>
                </div>
                <footer className="staging-start-row">
                  {enoughMembersToPlay
                    ? <button
                      className="action-button start-button staging-primary-button"
                      onClick={() => roundSettings && startWithShuffleOverlay(roundSettings)}
                      disabled={!roundSettings}
                      data-testid="start-button"
                    >{t('start')}</button>
                    : <p className="staging-need-one">{needsJoinBattle ? t('joinBattleFirst') : t('needOneMore')}</p>
                  }
                </footer>
              </>
            )}
          </>
        )
      }
    </div>
  );
}
