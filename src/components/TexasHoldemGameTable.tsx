import React, {useCallback, useEffect, useMemo, useRef} from 'react';

import '../App.css';

import useTexasHoldem from "../lib/texas-holdem/useTexasHoldem";
import MessageBar from "./MessageBar";
import useChatRoom from "../lib/useChatRoom";
import useEventLogs from "../lib/texas-holdem/useEventLogs";
import ScoreBoardAndToggle from "./ScoreBoardAndToggle";
import MySeat from "./MySeat";
import PokerTable from "./PokerTable";
import Opponents from "./Opponents";
import GameAudioToggle from "./GameAudioToggle";
import {useGameAudio} from "../lib/useGameAudio";
import FloatingInviteButton from "./FloatingInviteButton";
import SecurityStatusBar from "./SecurityStatusBar";
import AccountHomeButton from "./AccountHomeButton";
import PlayerAvatar from "./PlayerAvatar";
import {useI18n} from "../lib/i18n";
import {HostId, TableId} from "../lib/setup";
import LeaveSeatButton from "./LeaveSeatButton";
import RestartGameButton from "./RestartGameButton";
import HandPausePanel from "./HandPausePanel";
import {
  localTableIsBehindWorker,
  useWorkerRoomState,
  workerConnectionStatus,
  workerRoomRailPlayers,
  workerRoomSeatedPlayers,
} from "../lib/useWorkerRoomState";
import {WorkerRoomPlayerState} from "../lib/CloudflareRelayTransport";
import {useEncryptedShuffleStatus} from "../lib/useEncryptedShuffleStatus";
import {buildCreateTableUrl, upsertJoinedTable} from "../lib/tableLobby";
import {MAX_SEATS} from "../lib/texas-holdem/texasHoldemReducer";

const NEXT_HAND_AUTO_START_DELAY_MS = 5000;
const RETURN_TO_TABLE_PENDING_RESET_MS = 8000;
const NEXT_HAND_RECOVERY_RETRY_MS = 2000;
// Small delay so the just-emitted returnToTable event flushes to the relay before
// we reload (see requestReturnToTable). Overridable to 0 in tests.
const RETURN_TO_TABLE_RELOAD_DELAY_MS = 400;

// "Return to table" recovery is a full page reload by design: the relay already
// supports rebuilding the client from authoritative room-state and replaying the
// current hand, so a reload is the one recovery that can never get stuck in the
// live client's next-hand "who deals" election (the heads-up stand-up livelock).
// This is exactly what a manual refresh does — we just do it for the player.
// Guarded so a non-navigating test environment (jsdom) never throws.
function reloadForReturnToTable() {
  try {
    window.location.reload();
  } catch {
    /* jsdom / environments without navigation — no-op */
  }
}

export default function TexasHoldemGameTable() {
  const {t} = useI18n();
  const {
    peerState,
    playerId,
    members,
    players,
    round,
    currentRoundFinished,
    hole,
    holesPerPlayer,
    board,
    whoseTurnAndCallAmount,
    startGame,
    bankrolls,
    scoreBoard,
    handScoreBoard,
    totalDebt,
    potAmount,
    lastWinningResult,
    roundHistory,
    transcript,
    actionsDone,
    roundSettings,
    handPause,
    seriesProgress,
    canStartGame,
    reduced,
    actions,
  } = useTexasHoldem();
  const autoStartRoundRef = useRef<number | null>(null);
  const pendingManualNextHandStartRoundRef = useRef<number | null>(null);
  const [manualNextHandRecoveryRound, setManualNextHandRecoveryRound] = React.useState<number | null>(null);
  const [returnToTableRequestedAt, setReturnToTableRequestedAt] = React.useState<number | null>(null);
  const [registrationOpenedAt, setRegistrationOpenedAt] = React.useState<number | null>(null);
  const [mobileRailExpanded, setMobileRailExpanded] = React.useState(false);
  const spectatorEntryHandledRef = useRef(false);
  const {rejoinActiveHand} = actions;
  const workerRoomState = useWorkerRoomState(TableId);
  const hasWorkerState = Boolean(workerRoomState);
  const workerActivePlayerIds = useMemo(
    () => workerRoomSeatedPlayers(workerRoomState),
    [workerRoomState],
  );
  const workerNextHandPlayerIds = useMemo(() => {
    // Browser-authoritative: when the reducer has folded the signed log, the seated set
    // for the next hand comes from IT, not the worker's roomState. (Gated so the existing
    // worker-driven tests, which supply no `reduced`, keep exercising the worker path.)
    // The reducer already caps this at MAX_SEATS; the worker fallback is capped here too
    // so a stale/desynced worker view can never deal more than a standard 9-max table.
    if (reduced) {
      return reduced.seatedForNextHand;
    }
    if (!workerRoomState) {
      return workerActivePlayerIds.slice(0, MAX_SEATS);
    }
    const nextPlayers = workerRoomState.players
      .filter(player => (
        player.online
        && player.connected
        && player.seated
        && player.status === 'active'
        && !player.timedOut
        && !player.sittingOut
      ))
      .map(player => player.peerId);
    return (nextPlayers.length ? Array.from(new Set(nextPlayers)) : workerActivePlayerIds).slice(0, MAX_SEATS);
  }, [reduced, workerActivePlayerIds, workerRoomState]);
  // Reduced seating mapped into the worker player shape, so every downstream
  // seat/rail/recovery derivation can read from the browser-authoritative reducer
  // through ONE adapter (gated: null without a transcript ⇒ the worker path is used).
  const reducedWorkerPlayers = useMemo<WorkerRoomPlayerState[] | null>(() => {
    if (!reduced) {
      return null;
    }
    return reduced.seatPlayers.map(sp => ({
      peerId: sp.peerId,
      online: sp.online,
      connected: sp.online,
      seated: sp.seated,
      spectator: sp.online && !sp.seated,
      status: (sp.status === 'missing' ? 'offline' : sp.status) as WorkerRoomPlayerState['status'],
      timedOut: false,
      sittingOut: sp.status === 'sittingOut',
    }));
  }, [reduced]);
  const railPlayers = useMemo(
    () => (reducedWorkerPlayers
      ? reducedWorkerPlayers.filter(p => !p.seated && (p.online || p.status === 'offline'))
      : workerRoomRailPlayers(workerRoomState)),
    [reducedWorkerPlayers, workerRoomState],
  );
  const workerCanStartGame = reduced ? reduced.playable : (workerRoomState?.playable === true);
  // Client's own authoritative "can we start" (>= 2 seated locally), independent
  // of the worker roomState. Used as a host-only fallback so a stale/desynced
  // worker view can no longer deadlock the table ("观战中卡死"). Single host
  // starts ⇒ no double-deal.
  const localPlayable = canStartGame();
  const workerCurrentRound = workerRoomState?.currentRound ?? null;
  // Browser-authoritative current-hand identity: from the reducer when present, else the
  // worker. Used by every seat-recovery derivation so a finished/advanced hand is judged
  // from the signed log, not the worker's lagging currentRound.
  const effectiveCurrentRound = reduced ? reduced.currentRound : workerCurrentRound;
  const effectiveCurrentPlayers = useMemo<string[]>(() => {
    if (reduced) {
      return reduced.currentRound != null && reduced.handInProgress
        ? (reduced.rounds.get(reduced.currentRound)?.players ?? [])
        : [];
    }
    return workerRoomState?.currentPlayers ?? [];
  }, [reduced, workerRoomState]);
  const localIsBehindWorker = localTableIsBehindWorker(workerRoomState, round);
  const workerHandCannotContinue = Boolean(
    workerCurrentRound
    && workerRoomState
    && workerRoomState.currentPlayers.length < 2
    && workerNextHandPlayerIds.length >= 2
  );
  const effectiveCurrentRoundFinished = currentRoundFinished || workerHandCannotContinue;
  const startBlockedByCanonicalHand = reduced
    // Browser-authoritative: a hand is "live" iff the reduced log says so. No more
    // trusting the worker's currentRound (the stale value that dead-locked the next hand).
    ? Boolean(reduced.handInProgress && !effectiveCurrentRoundFinished)
    : Boolean(
      workerCurrentRound
      && (!round || workerCurrentRound > round || !effectiveCurrentRoundFinished)
    );
  const myWorkerPlayerState = useMemo(
    () => {
      if (!playerId) {
        return undefined;
      }
      if (reducedWorkerPlayers) {
        return reducedWorkerPlayers.find(player => player.peerId === playerId);
      }
      return workerRoomState?.players.find(player => player.peerId === playerId);
    },
    [playerId, reducedWorkerPlayers, workerRoomState],
  );
  const workerPlayerActiveInCurrentHand = Boolean(
    playerId
    && effectiveCurrentRound
    && effectiveCurrentPlayers.includes(playerId),
  );
  const localPlayerIsInActiveHand = Boolean(
    playerId
    && round
    && !currentRoundFinished
    && players?.includes(playerId)
  );
  // Browser-authoritative seat truth: my own client knows whether I belong at
  // this table. The worker's view of MY OWN presence lags reality — a refresh
  // briefly reports me offline/watching even though I am clearly here — so it
  // must never be what pulls me off the table.
  const iAmEstablishedPlayer = Boolean(
    playerId
    && (localPlayerIsInActiveHand || (roundHistory ?? []).some(item => item.players?.includes(playerId)))
  );
  // Browser-authoritative seat: the relay does NOT get to decide my own seat. If my
  // local engine knows I belong at this table (I'm in the live hand, or I've played
  // a hand here), I must never be rendered in the spectator rail just because the
  // worker briefly reports me as watching/offline after a refresh reconnect. The
  // worker's per-player seat opinion is ignored for my own seat entirely.
  const visibleRailPlayers = useMemo(
    () => railPlayers.filter(player => !(player.peerId === playerId && iAmEstablishedPlayer)),
    [railPlayers, playerId, iAmEstablishedPlayer],
  );
  const workerSaysWatching = myWorkerPlayerState?.status === 'watching';
  const workerSaysQueuedForNextHand = Boolean(
    playerId
    // "Queued" (seated but not dealt into the hand) only makes sense while a hand is
    // actually live; between hands nobody is queued. From the reducer that is
    // handInProgress; on the legacy worker path keep its (possibly stale) currentRound.
    && (reduced ? reduced.handInProgress : workerCurrentRound)
    && myWorkerPlayerState?.seated
    && !effectiveCurrentPlayers.includes(playerId)
  );
  const workerSaysAway = Boolean(
    myWorkerPlayerState
    // My own live-hand membership (known to my engine) wins over any stale worker view.
    && !localPlayerIsInActiveHand
    // For an established player of this table, transient offline/watching blips
    // (typically a page refresh re-establishing its socket) are never authoritative
    // about my seat — only a deliberate sit-out or a real timeout is.
    && !(iAmEstablishedPlayer && (myWorkerPlayerState.status === 'offline' || workerSaysWatching))
    && (
      workerSaysWatching
      || myWorkerPlayerState.status === 'sittingOut'
      || myWorkerPlayerState.status === 'timedOut'
      || myWorkerPlayerState.status === 'offline'
    )
  );
  const canonicalPlayers = useMemo(() => {
    if (reduced) {
      // During a live hand the in-seat set is the dealt-in players; between hands it is
      // the seated-for-next-hand set — both from the browser-authoritative reducer.
      if (reduced.currentRound != null && reduced.handInProgress) {
        return reduced.rounds.get(reduced.currentRound)?.players ?? reduced.seatedForNextHand;
      }
      return reduced.seatedForNextHand;
    }
    return workerRoomState ? workerRoomSeatedPlayers(workerRoomState).slice(0, MAX_SEATS) : (players ?? []);
  }, [reduced, players, workerRoomState]);
  const playerListForActiveViews = useMemo(() => {
    if (reduced || workerRoomState) {
      return canonicalPlayers;
    }
    return players;
  }, [reduced, canonicalPlayers, players, workerRoomState]);
  const canonicalCurrentRoundFinished = useMemo(() => {
    if (reduced) {
      // The hand is finished iff the signed log says no hand is in progress.
      return !reduced.handInProgress;
    }
    if (workerHandCannotContinue) {
      return true;
    }
    if (round === undefined) {
      return workerCurrentRound === null ? currentRoundFinished : false;
    }
    return localIsBehindWorker ? false : currentRoundFinished;
  }, [reduced, currentRoundFinished, localIsBehindWorker, round, workerCurrentRound, workerHandCannotContinue]);
  // The signed log decides my own seat — never the relay's lagging presence. When I am
  // dealt into the live hand per the browser-authoritative reducer, my seat (and bet
  // buttons) must render even if the worker momentarily reports me watching/offline while
  // a reopened socket re-establishes. This is the fix for "关掉回来下注按钮没了": the worker's
  // transient presence opinion could previously go false and hide my own action buttons
  // mid-hand. The worker-status gate is kept only for the legacy no-reducer fallback.
  const iAmDealtIntoLiveHand = Boolean(
    playerId
    && reduced?.handInProgress
    && reduced.currentRound != null
    && reduced.rounds.get(reduced.currentRound)?.players.includes(playerId)
  );
  const isInCanonicalSeat = Boolean(
    playerId
    && canonicalPlayers.includes(playerId)
    && (
      iAmDealtIntoLiveHand
      || !workerRoomState
      || !myWorkerPlayerState
      || workerPlayerActiveInCurrentHand
      || myWorkerPlayerState?.status === 'active'
    )
  );

  const seatByPeer = reduced?.seatByPeer;
  const mySeat = playerId ? seatByPeer?.get(playerId) : undefined;
  // Real-poker seat discipline: a seat change is only allowed BETWEEN hands, never while a
  // hand is live. The reducer enforces the same rule on the signed log; this flag also hides
  // the open-seat "+" mid-hand so a no-op click is never even offered.
  const canChangeSeat = !startBlockedByCanonicalHand;
  const handleTakeSeat = useCallback((seat: number) => {
    if (!canChangeSeat) return;
    void actions.takeSeat(seat);
  }, [actions, canChangeSeat]);

  const mainPotWinners = useMemo(() => {
    if (!currentRoundFinished || !lastWinningResult) {
      return null;
    }
    const winners: string[] = [];
    switch (lastWinningResult.how) {
      case 'LastOneWins':
        winners.push(lastWinningResult.winner);
        break
      case 'Showdown':
        winners.push(...lastWinningResult.showdown[0].players);
        break;
      case 'Voided':
        break;
    }
    return new Set(winners);
  }, [currentRoundFinished, lastWinningResult]);

  const {
    names,
    setMyName,
    messages,
    sendMessage,
  } = useChatRoom();

  useEffect(() => {
    if (!TableId) {
      return;
    }
    upsertJoinedTable({
      tableId: TableId,
      hostId: HostId,
      localPlayerId: playerId,
      title: playerId && names.get(playerId) ? `${names.get(playerId)} 的牌桌` : undefined,
    });
  }, [names, playerId]);

  const eventLogs = useEventLogs();
  const encryptedShuffleStatus = useEncryptedShuffleStatus();
  const audio = useGameAudio();
  const spokenActionIds = useRef<Set<string>>(new Set());
  const continueAfterPlannedHands = false;
  const matchComplete = !continueAfterPlannedHands && seriesProgress.complete && currentRoundFinished;
  const matchRegistrationOpen = Boolean(
    matchComplete
    && (
      registrationOpenedAt
      || effectiveCurrentRound === null
    )
  );
  const reportMatchComplete = matchComplete && !matchRegistrationOpen;
  const seatLost = Boolean(playerId && workerSaysAway);
  const seatLostByTimeout = myWorkerPlayerState?.status === 'timedOut';
  const seatLostByOffline = myWorkerPlayerState?.status === 'offline';
  const excludedFromLiveHand = Boolean(
    playerId
    && !canonicalCurrentRoundFinished
    && !canonicalPlayers.includes(playerId)
  );
  const excludedFromWorkerHand = Boolean(
    !reduced // with the reducer authoritative, "behind the worker" no longer applies
    && playerId
    && hasWorkerState
    && localIsBehindWorker
    && !workerRoomState?.currentPlayers.includes(playerId)
  );
  const showReturnToTablePanel = Boolean(
    !matchRegistrationOpen
    && (
      seatLost
      // The "queued / excluded from the hand" prompts are for a peer that genuinely
      // needs to (re)take a seat — a late joiner or a real spectator. An established
      // player of this table auto-rejoins, so a transient worker blip that drops me
      // from currentPlayers must NOT raise this panel (it would hide staging and make
      // the next hand feel like it started with no prompt).
      || (!iAmEstablishedPlayer && !workerHandCannotContinue && !localPlayerIsInActiveHand && (
        workerSaysQueuedForNextHand
        || excludedFromLiveHand
        || excludedFromWorkerHand
      ))
    )
  );
  const shouldShowRegistrationLobbyCards = !matchRegistrationOpen;
  const showHandPausePanel = Boolean(handPause && !effectiveCurrentRoundFinished);
  // A voided hand means a player left for good and the deck can't be decrypted —
  // the table is over. Everyone sees a clear notice and starts a fresh room.
  const tableEnded = lastWinningResult?.how === 'Voided';
  const showMessageBar = Boolean(playerId && (round || workerRoomState) && !matchRegistrationOpen);
  const isTableHost = Boolean(playerId && (!HostId || HostId === playerId));
  const workerMyConnectionStatus = workerConnectionStatus(myWorkerPlayerState);
  const myConnectionStatus: 'good' | 'warn' | 'offline' = workerMyConnectionStatus ?? 'warn';
  const recoveryRound = effectiveCurrentRound ?? round ?? null;
  const spectatorEntryRequested = useMemo(() => {
    return new URLSearchParams(window.location.search).get('spectator') === '1';
  }, []);
  const nextHandStarter = useMemo(() => {
    const currentActiveOrder = effectiveCurrentPlayers.filter(player => workerNextHandPlayerIds.includes(player));
    const starterOrder = effectiveCurrentRoundFinished && currentActiveOrder.length
      ? [
        ...currentActiveOrder,
        ...workerNextHandPlayerIds.filter(player => !currentActiveOrder.includes(player)),
      ]
      : workerNextHandPlayerIds;
    if (!effectiveCurrentRoundFinished || !round || starterOrder.length < 2) {
      return starterOrder[0];
    }
    return starterOrder[round % starterOrder.length];
  }, [effectiveCurrentRoundFinished, effectiveCurrentPlayers, round, workerNextHandPlayerIds]);
  const localPlayerCanStartNextHand = Boolean(
    playerId
    && workerNextHandPlayerIds.includes(playerId)
    && myWorkerPlayerState?.seated !== false
    && myWorkerPlayerState?.status !== 'timedOut'
    && myWorkerPlayerState?.status !== 'sittingOut'
  );
  // Host-only fallback authority for starting the next hand when the worker view
  // is not playable (stale/desynced). Gated on !workerCanStartGame so it is
  // mutually exclusive with the normal worker-driven path — only one client ever
  // starts a given hand (no double-deal).
  const localHostCanStartNext = Boolean(
    isTableHost && localPlayable && !workerCanStartGame && effectiveCurrentRoundFinished
  );
  const localPlayerControlsNextHand = Boolean(
    (playerId && localPlayerCanStartNextHand && nextHandStarter === playerId)
    || localHostCanStartNext
  );
  const startGameFromCanonicalTable = useCallback(async (settings?: Parameters<typeof startGame>[0]) => {
    // Host-only fallback: if the worker view isn't usable but the client can start
    // (>=2 seated locally), let the single host start from local state instead of
    // deadlocking. startGame() then deals the client's own seated players.
    const hostFallback = isTableHost && localPlayable;
    if (startBlockedByCanonicalHand && !hostFallback) {
      console.warn('Worker room state already has an active hand.');
      return;
    }
    if (workerRoomState && workerNextHandPlayerIds.length < 2 && !hostFallback) {
      console.warn('Worker room state does not have enough seated players.');
      return;
    }
    await startGame({
      ...settings,
      participants: workerNextHandPlayerIds.length >= 2 ? workerNextHandPlayerIds : settings?.participants,
    });
  }, [isTableHost, localPlayable, startBlockedByCanonicalHand, startGame, workerNextHandPlayerIds, workerRoomState]);

  const restartMatchFromFinalReport = useCallback(async () => {
    if (!round) {
      return;
    }
    try {
      await actions.openRegistration();
      setRegistrationOpenedAt(Date.now());
    } catch (err) {
      console.warn(err);
    }
  }, [actions, round]);

  const requestReturnToTable = useCallback(async () => {
    setReturnToTableRequestedAt(Date.now());
    try {
      if (matchRegistrationOpen) {
        // Between hands (registration open): an ordinary return for the next hand.
        await rejoinActiveHand(null, false);
      } else {
        // Mid-hand reconnect/refresh/reopen: let the engine resume if this client
        // can still decrypt the hand, or void the whole table if its keys are gone.
        // `workerPlayerActiveInCurrentHand` is the reliable "I was dealt into this
        // hand" signal even after a reopen wiped local state.
        await rejoinActiveHand(
          recoveryRound,
          workerPlayerActiveInCurrentHand || localPlayerIsInActiveHand,
        );
      }
      // The return event above authoritatively clears the sit-out on the relay.
      // Now reload so this client rebuilds from that corrected room-state instead of
      // staying in the live next-hand election, which can livelock heads-up after a
      // stand-up ("回到桌上"卡住, only a manual refresh recovered). The brief delay
      // lets the emitted event flush to the relay first.
      window.setTimeout(reloadForReturnToTable, RETURN_TO_TABLE_RELOAD_DELAY_MS);
    } catch (err) {
      setReturnToTableRequestedAt(null);
      console.warn(err);
    }
  }, [matchRegistrationOpen, recoveryRound, workerPlayerActiveInCurrentHand, localPlayerIsInActiveHand, rejoinActiveHand]);

  useEffect(() => {
    if (
      (!seatLost && localPlayerIsInActiveHand)
      || (myWorkerPlayerState?.seated && myWorkerPlayerState.status === 'active')
    ) {
      setReturnToTableRequestedAt(null);
    }
  }, [localPlayerIsInActiveHand, myWorkerPlayerState?.seated, myWorkerPlayerState?.status, seatLost]);

  useEffect(() => {
    if (workerRoomState?.currentRound) {
      setRegistrationOpenedAt(null);
    }
  }, [workerRoomState?.currentRound]);

  // AUTO-RESYNC: if the signed log (reducer, folded from the transcript every client receives)
  // has advanced to a LATER hand than the engine is actually showing, this client fell "a hand
  // behind" after a refresh/reconnect and did not catch up on its own — the exact case a manual
  // refresh fixed. Detect it and reload ONCE to rebuild from the relay's latest hand, so the
  // table keeps playing without anyone touching it ("断线就自动快速恢复"). A 6s grace ignores the
  // normal brief lag while a fresh newRound is being processed; a 20s cooldown makes it
  // impossible to loop.
  const reducedRoundNum = reduced?.currentRound ?? null;
  useEffect(() => {
    if (reducedRoundNum == null || !round || reducedRoundNum <= round) {
      return;
    }
    let lastAuto = 0;
    try { lastAuto = Number(sessionStorage.getItem('fairpoker:autoResyncAt') || 0); } catch { /* ignore */ }
    if (Date.now() - lastAuto < 20000) {
      return;
    }
    const timer = window.setTimeout(() => {
      try { sessionStorage.setItem('fairpoker:autoResyncAt', String(Date.now())); } catch { /* ignore */ }
      reloadForReturnToTable();
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [reducedRoundNum, round]);

  // AUTO-RECOVER A STALE PAUSE: a brief mutual network blip can leave THIS client
  // stuck on the hand-pause screen even after the player it is waiting on is back.
  // The browser-authoritative reducer (folded from the same membership) is the
  // source of truth for presence — if it shows EVERY paused-on player as online
  // again while the pause panel is still up after a grace period, the engine's
  // pause is stale and a reload re-syncs it (same self-heal as the manual "刷新重试"
  // button, done for the player). A genuine wait (the peer truly offline) never
  // satisfies `everyMissingBackOnline`, so it is never auto-reloaded; the 6s grace
  // ignores the normal sub-second clear, and a 20s cooldown prevents any loop.
  const pausedMissing = handPause?.missingPlayers;
  useEffect(() => {
    if (!showHandPausePanel || !pausedMissing || pausedMissing.length === 0 || !reduced) {
      return;
    }
    const everyMissingBackOnline = pausedMissing.every(pid =>
      reduced.seatPlayers.find(sp => sp.peerId === pid)?.online === true);
    if (!everyMissingBackOnline) {
      return;
    }
    let lastAuto = 0;
    try { lastAuto = Number(sessionStorage.getItem('fairpoker:pauseResyncAt') || 0); } catch { /* ignore */ }
    if (Date.now() - lastAuto < 20000) {
      return;
    }
    const timer = window.setTimeout(() => {
      try { sessionStorage.setItem('fairpoker:pauseResyncAt', String(Date.now())); } catch { /* ignore */ }
      reloadForReturnToTable();
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [showHandPausePanel, pausedMissing, reduced]);

  useEffect(() => {
    if (
      !spectatorEntryRequested
      || spectatorEntryHandledRef.current
      || !myWorkerPlayerState
      || round
      || workerCurrentRound
      || !myWorkerPlayerState.seated
    ) {
      return;
    }
    spectatorEntryHandledRef.current = true;
    actions.sitOut().catch(err => {
      spectatorEntryHandledRef.current = false;
      console.warn(err);
    });
  }, [actions, myWorkerPlayerState, round, spectatorEntryRequested, workerCurrentRound]);

  useEffect(() => {
    if (returnToTableRequestedAt === null) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setReturnToTableRequestedAt(null);
    }, RETURN_TO_TABLE_PENDING_RESET_MS);
    return () => window.clearTimeout(timeout);
  }, [returnToTableRequestedAt]);

  const spokenActions = useMemo(() => ({
    fireBet: async (amount: number) => {
      const bankroll = playerId ? bankrolls.get(playerId) ?? 0 : 0;
      if (amount === bankroll && bankroll > 0) {
        audio.speak('all in');
      } else if (amount === 0 && whoseTurnAndCallAmount?.callAmount === 0) {
        audio.speak('check');
      } else if (amount === whoseTurnAndCallAmount?.callAmount) {
        audio.speak('call');
      } else {
        audio.speak('raise');
      }
      await actions.fireBet(amount);
    },
    fireFold: async () => {
      audio.speak('fold');
      await actions.fireFold();
    },
    sitOut: async () => {
      audio.speak('fold');
      await actions.sitOut();
    },
    returnToTable: async () => {
      await requestReturnToTable();
    },
  }), [actions, audio, bankrolls, playerId, requestReturnToTable, whoseTurnAndCallAmount?.callAmount]);

  useEffect(() => {
    const latest = eventLogs[eventLogs.length - 1];
    if (!latest || latest.type === 'newRound' || latest.type === 'winner' || latest.type === 'fund') {
      return;
    }
    const id = `${latest.type}:${latest.playerId}:${latest.timestamp}`;
    if (spokenActionIds.current.has(id)) {
      return;
    }
    spokenActionIds.current.add(id);
    if (latest.playerId === playerId) {
      return;
    }
    switch (latest.type) {
      case 'check':
        audio.speak('check');
        break;
      case 'raise':
        audio.speak(latest.allin ? 'all in' : 'raise');
        break;
      case 'fold':
        audio.speak('fold');
        break;
    }
  }, [audio, eventLogs, playerId]);

  // Single source of truth for the shuffle animation: the REAL signed shuffle
  // transcript (useEncryptedShuffleStatus), which has its own min/stall/max timing.
  // There is no optimistic/manual overlay any more — that second source was what
  // made the animation "randomly appear" out of sync with the actual shuffle.
  const visibleShuffleOverlayStartedAt = encryptedShuffleStatus.visible
    ? encryptedShuffleStatus.startedAtMs ?? Date.now()
    : null;
  const visibleShuffleParticipants = encryptedShuffleStatus.visible
    ? encryptedShuffleStatus.participants
    : undefined;

  const startNextHandAfterCountdown = useCallback(async (options?: {manual?: boolean}) => {
    const manualRecovery = Boolean(options?.manual);
    if (
      !effectiveCurrentRoundFinished
      || !round
      || !playerId
      || matchComplete
      || !roundSettings
      || localIsBehindWorker
      || (manualRecovery && nextHandStarter !== playerId && !localHostCanStartNext)
      || (!manualRecovery && !localPlayerCanStartNextHand && !localHostCanStartNext)
      || (!manualRecovery && nextHandStarter !== playerId && !localHostCanStartNext)
      || (!manualRecovery && autoStartRoundRef.current === round)
    ) {
      return;
    }

    if (manualRecovery && (!workerCanStartGame || !localPlayerCanStartNextHand) && !localHostCanStartNext) {
      pendingManualNextHandStartRoundRef.current = round;
      setManualNextHandRecoveryRound(round);
      await requestReturnToTable();
      return;
    }

    if (!workerCanStartGame && !localHostCanStartNext) {
      console.warn('Worker room state is not playable yet.');
      return;
    }

    if (!workerRoomState && !canStartGame()) {
      if (manualRecovery) {
        pendingManualNextHandStartRoundRef.current = round;
        setManualNextHandRecoveryRound(round);
        await requestReturnToTable();
      }
      console.warn('Local game preflight rejected the worker-playable room.');
      return;
    }

    autoStartRoundRef.current = round;
    pendingManualNextHandStartRoundRef.current = null;
    setManualNextHandRecoveryRound(null);
    startGameFromCanonicalTable({
      ...roundSettings,
      plannedRounds: roundSettings.plannedRounds ?? seriesProgress.total,
      seriesStartRound: seriesProgress.complete && round ? round + 1 : roundSettings.seriesStartRound ?? round,
    }).catch(err => {
      autoStartRoundRef.current = null;
      console.warn(err);
    });
  }, [canStartGame, effectiveCurrentRoundFinished, localHostCanStartNext, localIsBehindWorker, localPlayerCanStartNextHand, matchComplete, nextHandStarter, playerId, requestReturnToTable, round, roundSettings, seriesProgress.complete, seriesProgress.total, startGameFromCanonicalTable, workerCanStartGame, workerRoomState]);

  useEffect(() => {
    if (
      manualNextHandRecoveryRound !== round
      || !effectiveCurrentRoundFinished
      || !round
      || !playerId
      || matchComplete
      || !roundSettings
      || !workerCanStartGame
      || (!workerRoomState && !canStartGame())
    ) {
      return;
    }
    pendingManualNextHandStartRoundRef.current = null;
    setManualNextHandRecoveryRound(null);
    void startNextHandAfterCountdown({manual: true});
  }, [
    canStartGame,
    effectiveCurrentRoundFinished,
    matchComplete,
    manualNextHandRecoveryRound,
    playerId,
    returnToTableRequestedAt,
    round,
    roundSettings,
    startNextHandAfterCountdown,
    workerCanStartGame,
    workerRoomState,
  ]);

  useEffect(() => {
    if (
      manualNextHandRecoveryRound !== round
      || !effectiveCurrentRoundFinished
      || !round
      || !playerId
      || matchComplete
      || !roundSettings
    ) {
      return;
    }

    const interval = window.setInterval(() => {
      void startNextHandAfterCountdown({manual: true});
    }, NEXT_HAND_RECOVERY_RETRY_MS);
    return () => window.clearInterval(interval);
  }, [
    effectiveCurrentRoundFinished,
    matchComplete,
    manualNextHandRecoveryRound,
    playerId,
    round,
    roundSettings,
    startNextHandAfterCountdown,
  ]);

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
  const seatRecoveryTitle = workerSaysQueuedForNextHand
    ? t('queuedForNextHandTitle')
    : workerSaysWatching
      ? t('watchingTitle')
      : seatLostByTimeout
        ? t('seatTimedOutTitle')
        : seatLostByOffline
        ? t('seatOfflineTitle')
        : t('seatLostTitle');
  const seatRecoveryCopy = returnToTableRequestedAt
    ? t('seatReturnPendingCopy')
    : workerSaysQueuedForNextHand
      ? t('queuedForNextHandCopy')
      : workerSaysWatching
      ? t('watchingCopy')
      : seatLostByTimeout || seatLostByOffline
      ? t('seatTimedOutCopy')
      : t('seatLostCopy');
  const returnToTableLabel = returnToTableRequestedAt
    ? t('returnToTablePending')
    : workerSaysQueuedForNextHand
      ? t('returnToTablePending')
      : seatLostByTimeout || seatLostByOffline || workerSaysWatching
      ? t('sitBackDown')
      : t('returnToTable');
  const returnToTableDisabled = false;
  const nextHandRecoveryRequested = Boolean(
    round
    && manualNextHandRecoveryRound === round
  );
  const showMySeat = Boolean(
    !reportMatchComplete
    && !matchRegistrationOpen
    && (
      (hasWorkerState
        && isInCanonicalSeat
      )
      || (!workerRoomState && (
        !round || (playerId && players?.includes(playerId))
        || (!players && !workerSaysWatching)
      ))
    )
  );

  return (
    <div className="App">
      <div className="fairpoker-quick-actions" aria-label={t('tableTools')}>
        <LeaveSeatButton
          disabled={!myWorkerPlayerState?.seated}
          onLeaveSeat={actions.sitOut}
        />
        <RestartGameButton />
        <SecurityStatusBar
          peerState={peerState}
          playerId={playerId}
          members={members}
          players={canonicalPlayers}
          round={round}
          seriesProgress={seriesProgress}
          currentRoundFinished={currentRoundFinished}
          boardCardsCount={board.length}
          whoseTurn={whoseTurnAndCallAmount?.whoseTurn}
          audio={audio}
        />
        <FloatingInviteButton playerId={playerId} />
        <GameAudioToggle audio={audio} />
        <AccountHomeButton />
      </div>
      {tableEnded && (
        <div className="seat-recovery-panel table-ended-panel" role="status" aria-live="assertive" data-testid="table-ended-panel">
          <i aria-hidden="true" />
          <strong>{t('tableEndedTitle')}</strong>
          <span>{t('tableEndedDesc')}</span>
          <button
            type="button"
            className="seat-recovery-button"
            onClick={() => { window.location.href = buildCreateTableUrl(); }}
            data-testid="new-room-button"
          >{t('newTable')}</button>
        </div>
      )}
      {showReturnToTablePanel && !tableEnded && (
        <div className="seat-recovery-panel seat-recovery-with-action" role="status" aria-live="polite" data-testid="seat-recovery-panel">
          <i aria-hidden="true" />
          <strong>{seatRecoveryTitle}</strong>
          <span>{seatRecoveryCopy}</span>
          <button
            type="button"
            className="seat-recovery-button"
            disabled={returnToTableDisabled}
            onClick={() => {
              if (!returnToTableDisabled) {
                void requestReturnToTable();
              }
            }}
            data-testid="return-to-table-button"
          >{returnToTableLabel}</button>
        </div>
      )}
      {showHandPausePanel && handPause && (
        <HandPausePanel
          pause={handPause}
          playerId={playerId}
          names={names}
          onVote={actions.voteToVoidHand}
          onRefresh={reloadForReturnToTable}
        />
      )}
      {visibleRailPlayers.length > 0 && (
        <aside
          className={mobileRailExpanded ? 'spectator-rail expanded' : 'spectator-rail collapsed'}
          aria-label={t('spectatorList')}
          data-testid="spectator-rail"
        >
          <button
            type="button"
            className="spectator-rail-toggle"
            onClick={() => setMobileRailExpanded(expanded => !expanded)}
            aria-expanded={mobileRailExpanded}
          >
            <strong>{t('spectatorList')}</strong>
            <span>{visibleRailPlayers.length}</span>
          </button>
          <div>
            {visibleRailPlayers.map(player => (
              <div className="spectator-rail-item" key={player.peerId}>
                <PlayerAvatar
                  playerId={player.peerId}
                  playerName={names.get(player.peerId) ?? (player.peerId === playerId ? t('me') : player.peerId.slice(0, 6))}
                  connectionStatus={workerConnectionStatus(player) ?? 'warn'}
                />
                <span>{railStatusLabel(player.status, player.seated)}</span>
              </div>
            ))}
          </div>
        </aside>
      )}
      {
        (playerId && round) &&
          <ScoreBoardAndToggle
              scoreBoard={scoreBoard}
              totalDebt={totalDebt}
              bankrolls={bankrolls}
              names={names}
              lastWinningResult={lastWinningResult}
              roundHistory={roundHistory}
              transcript={transcript}
              mainPotWinners={mainPotWinners}
              holesPerPlayer={holesPerPlayer}
              board={board}
              playerId={playerId}
              currentRoundFinished={currentRoundFinished}
              matchComplete={reportMatchComplete}
              canRestartMatch={isTableHost}
              onRestartMatch={isTableHost ? restartMatchFromFinalReport : undefined}
          />
      }
      <div className="poker-felt">
      {!reportMatchComplete && !canonicalCurrentRoundFinished && (
        <Opponents
          members={members}
          playerId={playerId}
          players={playerListForActiveViews}
          names={names}
          bankrolls={bankrolls}
          board={board}
          whoseTurn={whoseTurnAndCallAmount?.whoseTurn}
          holesPerPlayer={holesPerPlayer}
          mainPotWinners={mainPotWinners}
          lastWinningResult={lastWinningResult}
          scoreBoard={handScoreBoard}
          currentRoundFinished={canonicalCurrentRoundFinished}
          actionsDone={actionsDone}
          autoFoldTimeoutSeconds={roundSettings?.autoFoldTimeoutSeconds}
          roomState={workerRoomState}
          seatByPeer={seatByPeer}
          mySeat={mySeat}
          onTakeSeat={canChangeSeat ? handleTakeSeat : undefined}
        />
      )}
      {!reportMatchComplete && !matchRegistrationOpen && canonicalCurrentRoundFinished && (lastWinningResult?.how === 'Showdown' || lastWinningResult?.how === 'LastOneWins' || lastWinningResult?.how === 'Voided') && (
        <Opponents
          members={members}
          playerId={playerId}
          players={playerListForActiveViews}
          names={names}
          bankrolls={bankrolls}
          board={board}
          whoseTurn={undefined}
          holesPerPlayer={holesPerPlayer}
          mainPotWinners={mainPotWinners}
          lastWinningResult={lastWinningResult}
          scoreBoard={handScoreBoard}
          currentRoundFinished={canonicalCurrentRoundFinished}
          actionsDone={null}
          autoFoldTimeoutSeconds={roundSettings?.autoFoldTimeoutSeconds}
          roomState={workerRoomState}
          seatByPeer={seatByPeer}
          mySeat={mySeat}
          onTakeSeat={canChangeSeat ? handleTakeSeat : undefined}
        />
      )}
      <PokerTable
        members={members}
        playerId={playerId}
        players={shouldShowRegistrationLobbyCards ? canonicalPlayers : undefined}
        round={matchRegistrationOpen ? undefined : round}
        board={shouldShowRegistrationLobbyCards ? board : []}
        potAmount={shouldShowRegistrationLobbyCards ? potAmount : 0}
        currentRoundFinished={canonicalCurrentRoundFinished}
        lastWinningResult={lastWinningResult}
        startGame={startGameFromCanonicalTable}
        localPlayable={localPlayable}
        onRoundSettingsChange={actions.updateRoundSettings}
        roundSettings={roundSettings}
        seriesProgress={matchRegistrationOpen ? undefined : seriesProgress}
        names={names}
        nextHandAutoStartDelaySeconds={NEXT_HAND_AUTO_START_DELAY_MS / 1000}
        shuffleOverlayStartedAt={visibleShuffleOverlayStartedAt}
        shuffleParticipants={visibleShuffleParticipants}
        roomState={workerRoomState}
        registrationOpen={matchRegistrationOpen}
        suppressStaging={showReturnToTablePanel || tableEnded}
        nextHandRecoveryRequested={nextHandRecoveryRequested}
        returnToTableRequested={returnToTableRequestedAt !== null}
        onReturnToTable={requestReturnToTable}
        onNextHandCountdownComplete={localPlayerControlsNextHand ? startNextHandAfterCountdown : undefined}
      />
      </div>
      {showMySeat && !matchRegistrationOpen && (
        <MySeat
          playerId={playerId}
          players={canonicalPlayers}
          board={board}
          hole={hole}
          potAmount={potAmount}
          bankrolls={bankrolls}
          names={names}
          setMyName={setMyName}
          mainPotWinners={mainPotWinners}
          lastWinningResult={lastWinningResult}
          scoreDelta={playerId ? handScoreBoard.get(playerId) : undefined}
          currentRoundFinished={canonicalCurrentRoundFinished}
          isRejoinBlocked={seatLost}
          connectionStatus={myConnectionStatus}
          actionsDone={actionsDone}
          autoFoldTimeoutSeconds={roundSettings?.autoFoldTimeoutSeconds}
          audio={audio}
          whoseTurnAndCallAmount={whoseTurnAndCallAmount}
          actions={spokenActions}
        />
      )}
      { showMessageBar && playerId && <MessageBar
          playerId={playerId}
          names={names}
          eventLogs={eventLogs}
          messages={messages}
          onMessage={sendMessage} /> }
    </div>
  );
}
