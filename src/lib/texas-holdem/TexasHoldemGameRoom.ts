import {GameEvent, GameRoomEvents, GameRoomStatus} from "../GameRoom";
import {
  MentalPokerGameRoomEvents,
  MentalPokerRoundSettings
} from "../MentalPokerGameRoom";
import EventEmitter from "eventemitter3";
import LifecycleManager from "../LifecycleManager";
import {EventListener} from "../types";
import {Board, CARDS, evaluateStandardCards, Hole} from "../rules";
import Deferred from "../Deferred";
import {StandardCard} from "../secureMentalPoker";
import {handRank} from "phe";
import {TranscriptEntry, TranscriptSnapshot} from "../fairness/transcript";
import {validateTableEvent} from "../fairness/eventSchema";

export interface LastOneWins {
  how: 'LastOneWins',
  round: number,
  winner: string,
}

export interface ShowdownResult {
  how: 'Showdown',
  round: number,
  showdown: Array<{
    strength: number;
    handValue: number;
    players: string[];
  }>;
}

export interface VoidedHandResult {
  how: 'Voided',
  round: number,
  missingPlayers: string[],
  approvals: string[],
}

export type WinningResult =
  | LastOneWins
  | ShowdownResult
  | VoidedHandResult;

export interface HandPauseState {
  round: number;
  missingPlayers: string[];
  voters: string[];
  approvals: string[];
  rejections: string[];
  // Epoch ms when the manual "void & refund" vote unlocks (pauseStart + 15 min).
  // The hand never auto-voids; this only gates when the button becomes clickable.
  voidUnlockAtMs?: number;
}

export interface TexasHoldemGameRoomEvents {
  connected: (peerId: string) => void;
  status: (status: GameRoomStatus) => void;
  members: (members: string[]) => void;
  shuffled: () => void;

  players: (round: number, players: string[]) => void;
  board: (round: number, board: Board) => void;
  hole: (round: number, whose: string, hole: Hole) => void;
  bet: (round: number, amount: number, who: string, allin: boolean) => void;
  fold: (round: number, who: string) => void;
  pot: (round: number, amount: number) => void;

  whoseTurn: (round: number, whose: string | null, actionMeta?: {callAmount: number}) => void;
  allSet: (round: number) => void;
  fund: (fund: number, previousFund: number | undefined, whose: string, borrowed?: boolean) => void;
  winner: (result: WinningResult) => void;
  handPause: (state: HandPauseState | null) => void;
  roundSettings: (round: number, settings: TexasHoldemRoundSettings) => void;
  pendingRoundSettings: (settings: TexasHoldemRoundSettings) => void;
  transcript: (entry: TranscriptEntry<unknown>) => void;
}

export interface GameRoomLike<T> {
  peerIdAsync: Promise<string>;
  listener: EventListener<GameRoomEvents<GameEvent<T>>>;
  emitEvent: (e: GameEvent<T>) => Promise<void>;
  getTranscript?: () => TranscriptSnapshot<T>;
}

export interface MentalPokerGameRoomLike {
  listener: EventListener<MentalPokerGameRoomEvents>;
  peerId?: string;
  status?: GameRoomStatus;
  members: string[];
  startNewRound: (settings: MentalPokerRoundSettings) => Promise<number>;
  showCard: (round: number, cardOffset: number) => Promise<void>;
  dealCard: (round: number, cardOffset: number, recipient: string) => Promise<void>;
  // Optional recovery hooks (present on the real MentalPokerGameRoom; the test
  // doubles omit them). hasIndividualKeysForRound tells a returning player whether
  // it can still decrypt this hand; wipeRoundSecrets erases the hand's secrets the
  // moment it resolves.
  hasIndividualKeysForRound?: (round: number) => boolean;
  wipeRoundSecrets?: (round: number) => void;
  // True once the round's encrypted shuffle finished (its deck resolved) so cards can be
  // dealt. False while shuffling — including the permanent-false state a mid-shuffle
  // refresh leaves behind. Lets the stall watchdog cover the deal phase, not just the
  // board reveal. (Test doubles omit it; treated as ready when absent.)
  isDeckReadyForRound?: (round: number) => boolean;
}

export interface TexasHoldemRoundSettings {
  bits?: number;
  initialFundAmount: number;
  smallBlindAmount?: number;
  bigBlindAmount?: number;
  autoFoldTimeoutSeconds?: number;
  plannedRounds?: number;
  seriesStartRound?: number;
  participants?: string[];
}

export interface TexasHoldemStateSnapshot {
  currentRound?: number;
  playersByRound: Map<number, string[]>;
  boardByRound: Map<number, Board>;
  holesByRound: Map<number, Map<string, Hole>>;
  whoseTurnByRound: Map<number, { whoseTurn: string; callAmount: number } | null>;
  potAmount: number;
  bankrolls: Map<string, number>;
  winnersByRound: Map<number, WinningResult>;
  handPauseByRound: Map<number, HandPauseState>;
  settingsByRound: Map<number, TexasHoldemRoundSettings>;
  pendingRoundSettings?: TexasHoldemRoundSettings;
}

export const DEFAULT_SMALL_BLIND_AMOUNT = 1;
export const DEFAULT_BIG_BLIND_AMOUNT = 2;
export const DEFAULT_AUTO_FOLD_TIMEOUT_SECONDS = 60;
const MIN_AUTO_FOLD_TIMEOUT_SECONDS = 5;
export const DEFAULT_ENCRYPTION_BITS = 1024; // raised with the SRA security floor (Audit V2); normalizeMentalPokerBits clamps weaker requests up anyway
export const DEFAULT_PLANNED_ROUNDS = 10;
const MIN_PLANNED_ROUNDS = 1;
// Re-send hole/board decrypt-key requests, prodding peers (and a reconnecting player
// who is rebuilding) to publish their keys. FAST + frequent: a short ramp then a steady
// ~1.5s cadence for many attempts, so a board left waiting after a refresh runs out within
// a second or two of the returning player reconnecting — instead of the old slow backoff
// that took ~20-30s (the "全下后刷新偶发卡几十秒" UX). Re-prods are cheap (just re-requests;
// a not-yet-ready peer simply responds once it can), so a tight cadence is safe.
const STEADY_RETRY_MS = 1500;
const FAST_RETRY_RAMP_MS = [200, 400, 700, 1100];
const RETRY_ATTEMPTS = 24; // ~36s of prodding before giving up, re-prodding every ~1.5s
const HOLE_KEY_RETRY_DELAYS_MS = [...FAST_RETRY_RAMP_MS, ...Array(RETRY_ATTEMPTS - FAST_RETRY_RAMP_MS.length).fill(STEADY_RETRY_MS)];
const BOARD_KEY_RETRY_DELAYS_MS = [...FAST_RETRY_RAMP_MS, ...Array(RETRY_ATTEMPTS - FAST_RETRY_RAMP_MS.length).fill(STEADY_RETRY_MS)];
// If a pending card reveal makes NO progress (no card decrypts) for this long, the hand is
// genuinely unfinishable for this client — it cannot produce a needed decrypt key (e.g. a
// degraded mental-poker state after a refresh, where a SUBSEQUENT all-in board can never run
// out and even a reload doesn't recover it). The watchdog then declares cannotContinue so the
// table resolves (void if a peer is gone; fold the declarer if all connected — board not
// needed → resolves) instead of deadlocking forever. The retries above get ~12s to recover a
// merely-slow peer first.
const CRYPTO_STALL_MS = 12000;
// How long a hand may stay paused waiting for a missing player to come back
// before the still-present players automatically consent to void it (refunding
// the pot). This bounds the worst case where a player closes the browser and
// never returns, so a hand can no longer hang forever. Manual void voting still
// works immediately; this is only the fallback. A reconnect within this window
// resumes the hand normally.
// A disconnect mid-hand pauses the table and waits INDEFINITELY by default — no
// timer ever auto-voids, and present players are never timed out while waiting. The
// only way to end the hand early is a unanimous manual "void & refund" by everyone
// still seated, and that button only unlocks after this much time has passed (so a
// disconnected player has a real chance to come back, and nobody can rage-void).
export const VOID_VOTE_UNLOCK_MS = 15 * 60 * 1000; // 15 minutes

// While a hand is paused waiting on a missing player, re-judge presence from the
// LIVE mesh member set on this cadence. Safety net for the case where the
// underlying 'members' (peersChanged) event was MISSED on one side after a
// transient mutual disconnect, leaving that side stuck on "本局暂停/观战" even
// though the opponent is reachable again. The re-judge is idempotent: it only
// un-sticks a stale pause (and refreshes the seat view); it never invents a new
// pause nor churns the UI, and it runs ONLY while a pause is active.
export const PRESENCE_RECONCILE_MS = 3000;

enum Stage {
  PRE_FLOP = 0,
  FLOP = 1,
  TURN = 2,
  RIVER = 3,
}

export interface NewRoundEvent {
  type: 'newRound';
  round: number;
  players: string[];
  settings: TexasHoldemRoundSettings;
}

export interface BetEvent {
  type: 'action/bet';
  round: number;
  amount: number;
}

export interface FoldEvent {
  type: 'action/fold';
  round: number;
}

export interface AutoFoldEvent {
  type: 'action/autoFold';
  round: number;
  target: string;
}

export interface SitOutEvent {
  type: 'action/sitOut';
  round?: number | null;
}

export interface ReturnToTableEvent {
  type: 'action/returnToTable';
  round?: number | null;
}

export interface OpenRegistrationEvent {
  type: 'action/openRegistration';
  round?: number | null;
}

// Broadcast by each client when its (deterministic) engine resolves a hand — the
// explicit "this hand is over" signal the protocol previously lacked. The relay
// consumes it to clear the current round so seating returns to the lobby rule and
// the next hand can start, instead of a finished hand staying "live" forever
// (currentRound only cleared on openRegistration) and stranding a reconnected
// player into a dead-locked next hand. It carries only the round number; the
// actual winner/payout is already fully determined by the signed bet/fold/card
// events. Idempotent: the relay ignores a hand/result whose round is not the live
// one, so duplicate broadcasts from multiple clients (or a reconnect replay) are
// harmless. (State-rework Stage 1, audit D01 — the verifiable hand-end signal; see
// AUDIT_ALIGNED_STATE_REWORK_PLAN §6.)
export interface HandResultEvent {
  type: 'hand/result';
  round: number;
}

export interface VoidHandVoteEvent {
  type: 'action/voidHandVote';
  round: number;
  approve: boolean;
}

// Sent by a player who rejoined a hand they were dealt into but can no longer
// continue, because their per-card decryption keys are gone (e.g. closed the
// browser and came back on a device that had cleared storage). The hand can never
// complete without their key shares, so every client voids it immediately and
// deterministically — no vote, no waiting. (See rejoinActiveHand.)
export interface CannotContinueEvent {
  type: 'action/cannotContinue';
  round: number;
}

// Purely positional: the sender claims an absolute seat (0..8) around the table. It
// never affects dealing or turn order — only where each player is drawn. Synced via
// the signed log so every client agrees who sits where.
export interface TakeSeatEvent {
  type: 'action/takeSeat';
  seat: number;
}

export interface UpdateSettingsEvent {
  type: 'action/updateSettings';
  settings: TexasHoldemRoundSettings;
}

export type TexasHoldemTableEvent =
  | NewRoundEvent
  | UpdateSettingsEvent
  | BetEvent
  | FoldEvent
  | AutoFoldEvent
  | SitOutEvent
  | ReturnToTableEvent
  | OpenRegistrationEvent
  | HandResultEvent
  | VoidHandVoteEvent
  | CannotContinueEvent
  | TakeSeatEvent;

function normalizeAutoFoldTimeoutSeconds(timeoutSeconds: number | undefined) {
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds === undefined) {
    return undefined;
  }
  const normalized = Math.round(timeoutSeconds);
  if (normalized <= 0) {
    return undefined;
  }
  return Math.max(MIN_AUTO_FOLD_TIMEOUT_SECONDS, normalized);
}

function normalizePlannedRounds(plannedRounds: number | undefined) {
  if (!Number.isFinite(plannedRounds) || plannedRounds === undefined) {
    return DEFAULT_PLANNED_ROUNDS;
  }
  const normalized = Math.round(plannedRounds);
  return Math.max(MIN_PLANNED_ROUNDS, normalized);
}

function normalizeBlindAmount(amount: number | undefined, fallback: number) {
  if (!Number.isFinite(amount) || amount === undefined) {
    return fallback;
  }
  return Math.max(1, Math.round(amount));
}

function normalizeSeriesStartRound(seriesStartRound: number | undefined, fallback: number) {
  if (!Number.isFinite(seriesStartRound) || seriesStartRound === undefined) {
    return fallback;
  }
  return Math.max(1, Math.round(seriesStartRound));
}

export function normalizeRoundSettings(settings: TexasHoldemRoundSettings, fallbackSeriesStartRound: number): TexasHoldemRoundSettings {
  const smallBlindAmount = normalizeBlindAmount(settings.smallBlindAmount, DEFAULT_SMALL_BLIND_AMOUNT);
  const bigBlindAmount = Math.max(
    smallBlindAmount + 1,
    normalizeBlindAmount(settings.bigBlindAmount, DEFAULT_BIG_BLIND_AMOUNT),
  );
  return {
    bits: settings.bits ?? DEFAULT_ENCRYPTION_BITS,
    initialFundAmount: settings.initialFundAmount,
    smallBlindAmount,
    bigBlindAmount,
    autoFoldTimeoutSeconds: normalizeAutoFoldTimeoutSeconds(settings.autoFoldTimeoutSeconds),
    plannedRounds: normalizePlannedRounds(settings.plannedRounds),
    seriesStartRound: normalizeSeriesStartRound(settings.seriesStartRound, fallbackSeriesStartRound),
  };
}

class TexasHoldemRound {
  playersOrdered: Deferred<string[]> = new Deferred();
  initialFunds: Deferred<Map<string, number>> = new Deferred();
  knownCards: Array<Deferred<StandardCard>> = new Array(CARDS).fill({}).map(() => new Deferred());
  knownCardValues: Map<number, StandardCard> = new Map();

  pot: Map<string, number> = new Map();
  calledPlayers: Set<string> = new Set();
  foldPlayers: Set<string> = new Set();
  allInPlayers: Set<string> = new Set();

  stage: Stage = Stage.PRE_FLOP;
  showdownReady = false;
  result?: WinningResult = undefined;
  settings?: TexasHoldemRoundSettings;
  currentTurn: string | null = null;
  currentTurnStartedAtMs: number = 0;
  currentTurnTimer?: ReturnType<typeof setTimeout>;
  pausedMissingPlayers: string[] = [];
  disconnectedPlayers: Set<string> = new Set();
  voidVotes: Map<string, boolean> = new Map();
  // Set when the pause starts; the manual "void & refund" vote unlocks at this
  // epoch-ms (pauseStart + VOID_VOTE_UNLOCK_MS). No timer ever fires — the hand
  // waits indefinitely until the missing player returns or everyone votes to void.
  pauseGraceDeadlineMs?: number;
}

export class TexasHoldemGameRoom {
  private readonly gameRoom: GameRoomLike<TexasHoldemTableEvent>;
  private readonly mentalPokerGameRoom: MentalPokerGameRoomLike;
  private readonly emitter = new EventEmitter<TexasHoldemGameRoomEvents>();

  private readonly lcm = new LifecycleManager();

  private round: number = 0;
  private dataByRounds: Map<number, TexasHoldemRound> = new Map();

  private funds: Map<string, number> = new Map();
  // The round already baked into the seeded funds-checkpoint (0 = none). Replayed
  // events for rounds at or before it must NOT re-apply their fund changes on top of
  // the seeded balances, or an earlier hand's winnings get double-counted.
  private fundsCheckpointThroughRound = 0;
  private sittingOutPlayers: Set<string> = new Set();
  private playersByRound: Map<number, string[]> = new Map();
  private boardByRound: Map<number, Board> = new Map();
  private holesByRound: Map<number, Map<string, Hole>> = new Map();
  private whoseTurnByRound: Map<number, { whoseTurn: string; callAmount: number } | null> = new Map();
  private potAmount: number = 0;
  private winnersByRound: Map<number, WinningResult> = new Map();
  private handPauseByRound: Map<number, HandPauseState> = new Map();
  private settingsByRound: Map<number, TexasHoldemRoundSettings> = new Map();
  private pendingRoundSettings?: TexasHoldemRoundSettings;
  private holeKeyRetryTimers: Set<ReturnType<typeof setTimeout>> = new Set();
  private boardKeyRetryTimers: Set<ReturnType<typeof setTimeout>> = new Set();
  // Stall watchdog: per-round timer, reset on every decrypted card (progress) and armed when a
  // reveal is pending; if it fires, the reveal made no progress for CRYPTO_STALL_MS and the hand
  // is declared unfinishable so the table never deadlocks.
  private cryptoStallTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();
  // Debounced re-trigger that fires once the reconnect REPLAY burst settles. During replay,
  // continueUnlessAllSet reaches showdownReady but the board reveal + showdown are skipped
  // (replay guard). If `returnToTable` is processed before the replay finishes arriving, the
  // one-shot recovery races and the board never runs out (the intermittent "全下后刷新卡死"
  // even after the relay full-hand-replay fix). This settle timer re-drives the pending board
  // exactly once after the replay stream goes quiet, independent of returnToTable timing.
  private replaySettleTimer?: ReturnType<typeof setTimeout>;
  private readonly pauseGraceVoidMs: number;
  // Pause-only presence heartbeat (see PRESENCE_RECONCILE_MS). Runs while a hand is
  // paused so a side that missed the 'members' reconnect event still un-sticks within
  // a few seconds. lastReconciledMembersKey gates the seat re-announce so an ongoing
  // genuine pause does not re-emit 'members' every tick.
  private readonly presenceReconcileMs: number;
  private presenceReconcileTimer?: ReturnType<typeof setInterval>;
  private lastReconciledMembersKey = '';

  // Rounds for which this client has already broadcast a hand/result, so the
  // "hand over" signal is sent at most once per hand by this client.
  private broadcastedHandResults: Set<number> = new Set();
  // True only while a *replayed* (historical) table event is being handled, so the
  // hand-result broadcast is suppressed during reconnect replay (the live
  // resolution re-emits it if the hand is actually ending now).
  private activeEventReplay = false;

  // GameRoom emits committed events through EventEmitter, which does not wait
  // for async handlers. Queue every table event so turn/street state changes
  // cannot interleave when messages arrive close together or during replay.
  private eventChain: Promise<void> = Promise.resolve();

  constructor(
    gameRoom: GameRoomLike<TexasHoldemTableEvent | any>,
    mentalPokerGameRoom: MentalPokerGameRoomLike,
    options?: { pauseGraceVoidMs?: number; presenceReconcileMs?: number },
  ) {
    this.gameRoom = gameRoom;
    this.mentalPokerGameRoom = mentalPokerGameRoom;
    this.pauseGraceVoidMs = options?.pauseGraceVoidMs ?? VOID_VOTE_UNLOCK_MS;
    this.presenceReconcileMs = options?.presenceReconcileMs ?? PRESENCE_RECONCILE_MS;

    // Restore carried chip balances BEFORE any (replayed) event is processed, so a
    // refresh/reconnect mid-game does not lose winnings/rebuys from earlier hands.
    this.restoreFundsFromCheckpoint();

    this.propagate('connected');
    this.propagate('status');
    this.propagate('members');
    this.propagate('shuffled');

    // A resolved hand (win, fold-out, or void) no longer needs its decryption
    // secrets, so erase them from disk the moment it ends — they are only kept to
    // recover an *in-progress* hand. Runs for every end path since they all emit
    // 'winner'.
    this.emitter.on('winner', this.lcm.register((result) => {
      this.mentalPokerGameRoom.wipeRoundSecrets?.(result.round);
      const resolvedRound = this.dataByRounds.get(result.round);
      if (resolvedRound) {
        this.clearStallWatchdog(resolvedRound);
      }
      // Emit the explicit "hand over" signal so the relay clears the round and the
      // table seats everyone for the next hand. Once per round, never during replay.
      this.maybeBroadcastHandResult(result.round);
    }, listener => this.emitter.off('winner', listener)));

    mentalPokerGameRoom.listener.on('members', this.lcm.register((members) => {
      this.handleMembersChanged(members);
    }, listener => mentalPokerGameRoom.listener.off('members', listener)));

    this.gameRoom.listener.on('transcript', this.lcm.register((entry) => {
      this.emitter.emit('transcript', entry);
    }, listener => this.gameRoom.listener.off('transcript', listener)));

    // mental poker event listeners
    mentalPokerGameRoom.listener.on('card', this.lcm.register(async (round, offset, card) => {
      const roundData = this.getOrCreateDataForRound(round);
      roundData.knownCardValues.set(offset, card);
      roundData.knownCards[offset].resolve(card);
      // Deck-integrity guard: a legal 52-card deck never decrypts the SAME card at
      // two positions, so a duplicate is hard proof the shuffle was rigged (the
      // initial deck was not a real 52-card deck — nothing else validates that;
      // see mentalPokerSchema C01/D08). Refuse to play a provably corrupt deck.
      // (Audit V4 — detection; full prevention still needs a shuffle proof.)
      if (this.hasDuplicateKnownCard(roundData)) {
        void this.voidCorruptDeck(round, roundData);
        return;
      }
      // A decrypted card is real progress — reset the stall watchdog so only a hand
      // that genuinely stops producing cards is voided.
      this.pokeCryptoProgress(round, roundData);
      this.tryResolveShowdown(round, roundData);
    }, listener => mentalPokerGameRoom.listener.off('card', listener)));

    // texas holdem event listeners
    this.gameRoom.listener.on('event', this.lcm.register(({ data }, who, replay) => {
      // Reject structurally invalid wire events before they reach the state
      // machine, so malformed/malicious payloads cannot corrupt state or throw.
      // (Audit C08 runtime schema validation, E02 malformed-input DoS.)
      const validation = validateTableEvent(data);
      if (!validation.ok) {
        console.warn(`Dropping invalid Texas Hold'em event: ${validation.reason}`);
        return;
      }
      // A funds-checkpoint already bakes in every round up to `throughRound`. When a
      // refresh's relay replay reaches further back than the current hand, re-applying
      // those settled rounds' bets/awards on top of the seeded balances double-counts an
      // earlier hand (e.g. a winner's stack inflates), so a later all-in is mis-sized and
      // the hand can stall. Skip replayed table events for rounds already in the
      // checkpoint. (No effect without a checkpoint — fundsCheckpointThroughRound stays 0.)
      const eventRound = (data as { round?: unknown }).round;
      if (this.fundsCheckpointThroughRound > 0 && typeof eventRound === 'number' && eventRound <= this.fundsCheckpointThroughRound) {
        return;
      }
      const handle = () => {
        switch (data.type) {
          case 'newRound':
            return this.handleNewRoundEvent(data, !!replay);
          case 'action/updateSettings':
            return this.handleUpdateSettingsEvent(data);
          case 'action/bet':
            return this.handleBetEvent(data, who, !!replay);
          case 'action/fold':
            return this.handleFoldEvent(data, who, !!replay);
          case 'action/autoFold':
            return this.handleAutoFoldEvent(data, !!replay);
          case 'action/sitOut':
            return this.handleSitOutEvent(data, who, !!replay);
          case 'action/returnToTable':
            return this.handleReturnToTableEvent(data, who, !!replay);
          case 'action/openRegistration':
            return this.handleOpenRegistrationEvent();
          case 'action/voidHandVote':
            return this.handleVoidHandVoteEvent(data, who);
          case 'action/cannotContinue':
            return this.handleCannotContinueEvent(data, who, !!replay);
          case 'hand/result':
            // Informational "hand over" signal consumed by the relay/verifier; this
            // client already resolved the hand locally, so there is nothing to do.
            return;
          case 'action/takeSeat':
            // Purely positional — consumed by the browser-authoritative reducer for
            // seat placement only; the stateful engine ignores it (no deal/turn impact).
            return;
        }
      };

      // Track whether the event currently being handled is a replayed historical
      // one, so the hand-result broadcast fires only for live resolutions. The
      // event chain serializes handlers, so this flag is correct for the duration
      // of each (possibly async) handler.
      this.eventChain = this.eventChain.then(async () => {
        this.activeEventReplay = !!replay;
        try {
          await handle();
        } catch (error) {
          console.error(`Failed to handle Texas Hold'em event ${data.type}.`, error);
        } finally {
          this.activeEventReplay = false;
          // After a replayed event, (re)arm the settle timer ONLY when the current hand is
          // actually waiting on the board/showdown (all betting done). When the replay burst
          // goes quiet, re-drive that pending board — robust against returnToTable racing the
          // replay. Gated so a normal current-turn replay arms no extra timer.
          if (replay) {
            const rd = this.round ? this.dataByRounds.get(this.round) : undefined;
            if (rd && !rd.result && rd.showdownReady) {
              this.scheduleReplaySettleReveal();
            }
          }
        }
      });
    }, listener => this.gameRoom.listener.off('event', listener)));
  }

  private scheduleReplaySettleReveal() {
    if (this.replaySettleTimer) {
      clearTimeout(this.replaySettleTimer);
    }
    this.replaySettleTimer = setTimeout(() => {
      this.replaySettleTimer = undefined;
      void this.completePendingBoardAfterReplay();
    }, 80);
  }

  // Re-drive a hand left waiting on the board/showdown after a reconnect replay. Only acts on
  // an unresolved hand whose betting is already complete (showdownReady) that THIS client is
  // a non-folded participant of — exactly the all-in-board case. revealBoardCards/showdown are
  // idempotent (re-publishing keys is safe), so a redundant call on a brief reconnect is a
  // no-op. Serialized through the event chain so it never interleaves a live handler.
  private async completePendingBoardAfterReplay() {
    this.eventChain = this.eventChain.then(async () => {
      const round = this.round;
      if (!round) return;
      const roundData = this.dataByRounds.get(round);
      if (!roundData || roundData.result || !roundData.showdownReady) return;
      const myId = await this.gameRoom.peerIdAsync;
      const players = await roundData.playersOrdered.promise;
      if (!players.includes(myId) || roundData.foldPlayers.has(myId)) return;
      try {
        await this.resumePendingCardDisclosure(round, roundData);
      } catch (error) {
        console.warn('completePendingBoardAfterReplay failed', error);
      }
    });
  }

  async startNewRound(settings: TexasHoldemRoundSettings) {
    await this.eventChain;
    const normalizedSettings = normalizeRoundSettings(settings, settings.seriesStartRound ?? this.round + 1);
    const players = this.getNextRoundPlayers(settings.participants);
    if (players.length < 2) {
      throw new Error('There should be at least 2 players to start a new round.');
    }

    const sbOffset = this.round % players.length;
    const playersOrdered = [
      ...players.slice(sbOffset),
      ...players.slice(0, sbOffset),
    ];

    this.round = await this.mentalPokerGameRoom.startNewRound({
      participants: playersOrdered,
      bits: normalizedSettings.bits,
    });

    await this.gameRoom.emitEvent({
      type: 'public',
      sender: await this.gameRoom.peerIdAsync,
      data: {
        type: 'newRound',
        round: this.round,
        settings: normalizedSettings,
        players: playersOrdered,
      },
    });
  }

  async updateRoundSettings(settings: TexasHoldemRoundSettings) {
    await this.gameRoom.emitEvent({
      type: 'public',
      sender: await this.gameRoom.peerIdAsync,
      data: {
        type: 'action/updateSettings',
        settings,
      },
    });
  }

  canStartNewRound() {
    return this.getNextRoundPlayers().length >= 2;
  }

  async bet(round: number, amount: number) {
    await this.clearLocalTurnTimerForSubmittedAction(round);
    await this.gameRoom.emitEvent({
      type: 'public',
      sender: await this.gameRoom.peerIdAsync,
      data: {
        type: 'action/bet',
        round,
        amount,
      },
    });
  }

  async fold(round: number) {
    await this.clearLocalTurnTimerForSubmittedAction(round);
    await this.gameRoom.emitEvent({
      type: 'public',
      sender: await this.gameRoom.peerIdAsync,
      data: {
        type: 'action/fold',
        round,
      },
    });
  }

  async autoFold(round: number, target: string) {
    await this.gameRoom.emitEvent({
      type: 'public',
      sender: await this.gameRoom.peerIdAsync,
      data: {
        type: 'action/autoFold',
        round,
        target,
      },
    });
  }

  async sitOut(round?: number | null) {
    if (typeof round === 'number') {
      await this.clearLocalTurnTimerForSubmittedAction(round);
    }
    await this.gameRoom.emitEvent({
      type: 'public',
      sender: await this.gameRoom.peerIdAsync,
      data: {
        type: 'action/sitOut',
        round,
      },
    });
  }

  async returnToTable(round?: number | null) {
    await this.gameRoom.emitEvent({
      type: 'public',
      sender: await this.gameRoom.peerIdAsync,
      data: {
        type: 'action/returnToTable',
        round,
      },
    });
  }

  // Positional only: claim an absolute seat around the table. Does not touch dealing
  // or turn order — just where the player is drawn (synced via the signed log).
  async takeSeat(seat: number) {
    await this.gameRoom.emitEvent({
      type: 'public',
      sender: await this.gameRoom.peerIdAsync,
      data: {
        type: 'action/takeSeat',
        seat,
      },
    });
  }

  async declareCannotContinue(round: number) {
    await this.gameRoom.emitEvent({
      type: 'public',
      sender: await this.gameRoom.peerIdAsync,
      data: {
        type: 'action/cannotContinue',
        round,
      },
    });
  }

  // Called when a player comes back to the table mid-session (reconnect / refresh
  // / reopen). The decision is made by the one client that actually knows whether
  // it can keep playing — itself:
  //   • keys still on hand (refresh, or reopen with persisted keys) → return
  //     normally and the hand resumes;
  //   • dealt into the live hand but keys are gone (reopened on a device that
  //     cleared storage) → declare the hand unfinishable so the whole table voids
  //     cleanly instead of freezing waiting on cards that can never be revealed.
  // `wasDealtIntoHand` comes from the room view (am I one of this hand's players),
  // and the void handler re-checks participation, so a mere spectator can never
  // trigger a void.
  async rejoinActiveHand(round: number | null | undefined, wasDealtIntoHand: boolean) {
    if (typeof round !== 'number' || !wasDealtIntoHand) {
      await this.returnToTable(round ?? null);
      return;
    }
    const roundData = this.dataByRounds.get(round);
    if (roundData?.result) {
      await this.returnToTable(round);
      return;
    }
    const keysAvailable = this.mentalPokerGameRoom.hasIndividualKeysForRound?.(round) ?? true;
    if (!keysAvailable) {
      await this.declareCannotContinue(round);
      return;
    }
    await this.returnToTable(round);
  }

  async openRegistration(round?: number | null) {
    await this.gameRoom.emitEvent({
      type: 'public',
      sender: await this.gameRoom.peerIdAsync,
      data: {
        type: 'action/openRegistration',
        round,
      },
    });
  }

  // Broadcast the "this hand is over" signal exactly once per round (and never
  // while replaying history on reconnect). Every client resolves the hand
  // identically, so it is safe — and intentionally resilient — for more than one
  // client to send it; the relay applies it idempotently.
  private maybeBroadcastHandResult(round: number) {
    if (typeof round !== 'number' || !Number.isFinite(round)) {
      return;
    }
    if (this.activeEventReplay) {
      return;
    }
    if (this.broadcastedHandResults.has(round)) {
      return;
    }
    this.broadcastedHandResults.add(round);
    void this.broadcastHandResult(round);
  }

  private async broadcastHandResult(round: number) {
    try {
      await this.gameRoom.emitEvent({
        type: 'public',
        sender: await this.gameRoom.peerIdAsync,
        data: {
          type: 'hand/result',
          round,
        },
      });
    } catch (error) {
      console.warn('Failed to broadcast hand/result event.', error);
    }
  }

  async voteToVoidHand(round: number, approve: boolean) {
    await this.gameRoom.emitEvent({
      type: 'public',
      sender: await this.gameRoom.peerIdAsync,
      data: {
        type: 'action/voidHandVote',
        round,
        approve,
      },
    });
  }

  get listener(): EventListener<TexasHoldemGameRoomEvents> {
    return this.emitter;
  }

  get peerId() {
    return this.mentalPokerGameRoom.peerId;
  }

  get status() {
    return this.mentalPokerGameRoom.status ?? 'NotReady';
  }

  get members() {
    return this.mentalPokerGameRoom.members;
  }

  private getNextRoundPlayers(overridePlayers?: string[]) {
    const seatedPlayers = this.mentalPokerGameRoom.members
      // 'worker-relay' is the relay's system identity, never a player — exclude it so a
      // reconnect can never deal a phantom relay participant into the hand.
      .filter(player => !this.sittingOutPlayers.has(player) && player !== 'worker-relay');
    if (overridePlayers?.length) {
      const canonicalPlayers = overridePlayers.filter((player, index) => (
        overridePlayers.indexOf(player) === index
      ));
      if (canonicalPlayers.length > 0) {
        return canonicalPlayers;
      }
    }
    const seatedPlayerSet = new Set(seatedPlayers);
    const previousPlayers = this.playersByRound.get(this.round);
    const previousPlayersStillSeated = previousPlayers
      ? previousPlayers.filter(player => seatedPlayerSet.has(player))
      : [];
    const newSeatedPlayers = seatedPlayers.filter(player => !previousPlayersStillSeated.includes(player));
    return previousPlayersStillSeated.length > 0
      ? [...previousPlayersStillSeated, ...newSeatedPlayers]
      : seatedPlayers;
  }

  close() {
    for (const roundData of Array.from(this.dataByRounds.values())) {
      this.clearTurnTimer(roundData);
      this.clearPauseGraceTimer(roundData);
      this.clearStallWatchdog(roundData);
    }
    for (const timer of Array.from(this.holeKeyRetryTimers)) {
      clearTimeout(timer);
    }
    this.holeKeyRetryTimers.clear();
    for (const timer of Array.from(this.boardKeyRetryTimers)) {
      clearTimeout(timer);
    }
    this.boardKeyRetryTimers.clear();
    if (this.replaySettleTimer) {
      clearTimeout(this.replaySettleTimer);
      this.replaySettleTimer = undefined;
    }
    for (const timer of Array.from(this.cryptoStallTimers.values())) {
      clearTimeout(timer);
    }
    this.cryptoStallTimers.clear();
    this.stopPresenceReconcile();
    this.lcm.close();
  }

  getTranscript(): TranscriptSnapshot<TexasHoldemTableEvent> | null {
    return this.gameRoom.getTranscript?.() ?? null;
  }

  getStateSnapshot(): TexasHoldemStateSnapshot {
    return {
      currentRound: this.round || undefined,
      playersByRound: new Map(Array.from(this.playersByRound.entries()).map(([round, players]) => [round, [...players]])),
      boardByRound: new Map(Array.from(this.boardByRound.entries()).map(([round, board]) => [round, [...board] as Board])),
      holesByRound: new Map(Array.from(this.holesByRound.entries()).map(([round, holes]) => [round, new Map(holes)])),
      whoseTurnByRound: new Map(this.whoseTurnByRound),
      potAmount: this.potAmount,
      bankrolls: new Map(this.funds),
      winnersByRound: new Map(this.winnersByRound),
      handPauseByRound: new Map(this.handPauseByRound),
      settingsByRound: new Map(this.settingsByRound),
      pendingRoundSettings: this.pendingRoundSettings,
    };
  }

  private propagate(eventName: (keyof (MentalPokerGameRoomEvents | TexasHoldemGameRoomEvents))) {
    this.mentalPokerGameRoom.listener.on(eventName, this.lcm.register((...args) => {
      this.emitter.emit(eventName, ...args);
    }, listener => this.mentalPokerGameRoom.listener.off(eventName, listener)));
  }

  private getOrCreateDataForRound(round: number): TexasHoldemRound {
    if (this.round < round) {
      this.round = round;
    }
    const existing = this.dataByRounds.get(round);
    if (existing) {
      return existing;
    }

    const roundData = new TexasHoldemRound();

    // hole
    this.registerHoleEvents(round, roundData);

    // winner (for showdown)
    this.registerWinnerEvents(round, roundData);

    this.dataByRounds.set(round, roundData);
    return roundData;
  }

  private registerHoleEvents(round: number, roundData: TexasHoldemRound) {
    for (let i = 5; (i + 1) < roundData.knownCards.length; i += 2) {
      Promise.all([
        roundData.knownCards[i].promise,
        roundData.knownCards[i + 1].promise,
        roundData.playersOrdered.promise,
      ]).then(([hole1, hole2, playersOrdered]) => {
        const hole: Hole = [hole1, hole2];
        const playerOffset = Math.floor((i - 5) / 2);
        if (playerOffset < playersOrdered.length) {
          const holes = this.holesByRound.get(round) ?? new Map<string, Hole>();
          holes.set(playersOrdered[playerOffset], hole);
          this.holesByRound.set(round, holes);
          this.emitter.emit('hole', round, playersOrdered[playerOffset], hole);
        }
      });
    }
  }

  private registerWinnerEvents(round: number, roundData: TexasHoldemRound) {
    roundData.playersOrdered.promise.then(() => this.tryResolveShowdown(round, roundData));
  }

  private async tryResolveShowdown(round: number, roundData: TexasHoldemRound) {
    if (!roundData.showdownReady || roundData.result) {
      return;
    }
    const players = await roundData.playersOrdered.promise;
    if (roundData.result) {
      return;
    }

    const eligiblePlayers = players
      .map((player, playerOffset) => ({player, playerOffset}))
      .filter(({player}) => !roundData.foldPlayers.has(player));
    if (eligiblePlayers.length < 2) {
      return;
    }

    const requiredOffsets = [
      0, 1, 2, 3, 4,
      ...eligiblePlayers.flatMap(({playerOffset}) => [
        playerOffset * 2 + 5,
        playerOffset * 2 + 6,
      ]),
    ];
    if (!requiredOffsets.every(offset => roundData.knownCardValues.has(offset))) {
      return;
    }

    const board = [0, 1, 2, 3, 4].map(offset => roundData.knownCardValues.get(offset)!);
    const strengthOfPlayers: Array<{
      player: string;
      handValue: number;
      strength: number;
    }> = [];
    for (const {player, playerOffset} of eligiblePlayers) {
      const holeOffsets = [
        playerOffset * 2 + 5,
        playerOffset * 2 + 6,
      ];
      const hole = [
        roundData.knownCardValues.get(holeOffsets[0])!,
        roundData.knownCardValues.get(holeOffsets[1])!,
      ];
      const strength = evaluateStandardCards([...hole, ...board]);
      const handValue = handRank(strength);
      strengthOfPlayers.push({
        player,
        handValue,
        strength,
      });
    }

    const result: ShowdownResult['showdown'] = [];
    for (const s of strengthOfPlayers.sort((s1, s2) => s1.strength - s2.strength)) {
      const last = result.length > 0 ? result[result.length - 1] : null;
      if (last && last.strength === s.strength) {
        last.players.push(s.player);
      } else {
        result.push({
          players: [s.player],
          handValue: s.handValue,
          strength: s.strength,
        });
      }
    }

    roundData.result = {
      how: 'Showdown',
      round,
      showdown: result,
    };
    this.clearTurnTimer(roundData);
    this.winnersByRound.set(round, roundData.result);
    this.emitter.emit('winner', roundData.result);

    const awards = this.calculateAwards(roundData, result);
    for (let [winner, award] of Array.from(awards.entries())) {
      const newFundOfWinner = (this.funds.get(winner) ?? 0) + award;
      this.updateFundOfPlayer(winner, newFundOfWinner);
    }
  }

  private calculateAwards(roundData: TexasHoldemRound, showdownResult: ShowdownResult['showdown']) {
    const pot = new Map(roundData.pot);
    const amountsToBeUpdated = new Map<string, number>();
    for (let result of showdownResult) {
      const winners = result.players.sort((p1, p2) => (pot.get(p1) ?? 0) - (pot.get(p2) ?? 0));
      let amountUnallocated: number = 0;
      for (let winnerOffset = 0; winnerOffset < winners.length; ++winnerOffset) {
        let winner = winners[winnerOffset];
        const betPortion = pot.get(winner) ?? 0;

        for (let [p, betAmount] of Array.from(pot.entries())) {
          const wonAmount = Math.min(betPortion, betAmount);
          amountUnallocated += wonAmount;
          const remaining = betAmount - wonAmount;
          if (remaining === 0) {
            pot.delete(p);
          } else {
            pot.set(p, remaining);
          }
        }

        const wonPortion = Math.floor(amountUnallocated / (winners.length - winnerOffset));
        amountUnallocated -= wonPortion;
        console.log(`Player ${winner} won ${wonPortion}.`);
        amountsToBeUpdated.set(winner, (amountsToBeUpdated.get(winner) ?? 0) + wonPortion);
      }
    }
    // remaining
    for (let [p, remaining] of Array.from(pot.entries())) {
      amountsToBeUpdated.set(p, (amountsToBeUpdated.get(p) ?? 0) + remaining);
    }
    // remove zero amount
    for (let [p, amount] of Array.from(amountsToBeUpdated)) {
      if (amount === 0) {
        amountsToBeUpdated.delete(p);
      }
    }
    return amountsToBeUpdated;
  }

  private updateVisibleBoard(round: number, roundData: TexasHoldemRound, board: Board) {
    switch (board.length) {
      case 0:
        roundData.stage = Stage.PRE_FLOP;
        break;
      case 3:
        roundData.stage = Stage.FLOP;
        break;
      case 4:
        roundData.stage = Stage.TURN;
        break;
      case 5:
        roundData.stage = Stage.RIVER;
        break;
    }
    this.boardByRound.set(round, [...board] as Board);
    this.emitter.emit('board', round, board);
  }

  private visibleBoardCountForStage(stage: Stage) {
    switch (stage) {
      case Stage.PRE_FLOP:
        return 0;
      case Stage.FLOP:
        return 3;
      case Stage.TURN:
        return 4;
      case Stage.RIVER:
        return 5;
    }
  }

  private advanceBoardStage(roundData: TexasHoldemRound, visibleCount: 3 | 4 | 5) {
    switch (visibleCount) {
      case 3:
        roundData.stage = Stage.FLOP;
        break;
      case 4:
        roundData.stage = Stage.TURN;
        break;
      case 5:
        roundData.stage = Stage.RIVER;
        break;
    }
  }

  private async revealBoardCards(
    round: number,
    roundData: TexasHoldemRound,
    visibleCount: 3 | 4 | 5,
    replay?: boolean,
    forceResend = false,
    allowRetry = true,
  ) {
    const currentVisibleCount = this.visibleBoardCountForStage(roundData.stage);
    const currentBoardCount = this.boardByRound.get(round)?.length ?? 0;
    if (!forceResend && visibleCount <= currentVisibleCount && currentBoardCount >= visibleCount) {
      return;
    }

    if (!replay) {
      const firstMissingOffset = forceResend ? 0 : Math.min(currentBoardCount, visibleCount);
      for (let cardOffset = firstMissingOffset; cardOffset < visibleCount; cardOffset += 1) {
        await this.mentalPokerGameRoom.showCard(round, cardOffset);
      }
    }

    this.advanceBoardStage(roundData, visibleCount);
    // A board reveal is now pending — arm the stall watchdog so the table cannot
    // freeze if a participant never publishes their key for these cards.
    this.pokeCryptoProgress(round, roundData);
    Promise.all(roundData.knownCards.slice(0, visibleCount).map(d => d.promise)).then(board => {
      if ((this.boardByRound.get(round)?.length ?? 0) < visibleCount) {
        this.updateVisibleBoard(round, roundData, board as Board);
      }
    });
    if (allowRetry) {
      this.scheduleBoardKeyRetry(round, roundData, visibleCount);
    }
  }

  private scheduleBoardKeyRetry(round: number, roundData: TexasHoldemRound, visibleCount: 3 | 4 | 5, attempt = 0) {
    const delayMs = BOARD_KEY_RETRY_DELAYS_MS[attempt];
    if (delayMs === undefined || roundData.result || (this.boardByRound.get(round)?.length ?? 0) >= visibleCount) {
      return;
    }
    const timer = setTimeout(() => {
      this.boardKeyRetryTimers.delete(timer);
      if (roundData.result || (this.boardByRound.get(round)?.length ?? 0) >= visibleCount) {
        return;
      }
      void this.revealBoardCards(round, roundData, visibleCount, false, true, false)
        .catch(error => {
          console.warn(`Unable to retry public board key delivery for round ${round}.`, error);
        })
        .finally(() => {
          this.scheduleBoardKeyRetry(round, roundData, visibleCount, attempt + 1);
        });
    }, delayMs);
    this.boardKeyRetryTimers.add(timer);
  }

  private async handleNewRoundEvent(e: NewRoundEvent, replay: boolean) {
    // IDEMPOTENCY GUARD: a newRound for a round we have ALREADY set up must not run again.
    // Re-running re-applies the auto-rebuy AND re-posts the blinds, corrupting funds (a
    // busted player gets topped up twice, blinds get re-deducted, "messy chips"). This
    // happens whenever a reconnect replays the current hand's events the engine already
    // processed (the handStartSeq replay window). `playersByRound` is set only here, so it
    // is a reliable "this round's newRound already ran" marker. A fresh engine (full page
    // reload) sees each round for the first time and sets it up normally.
    if (this.playersByRound.has(e.round)) {
      return;
    }

    const normalizedSettings = normalizeRoundSettings(e.settings, e.round);
    this.pendingRoundSettings = normalizedSettings;
    this.emitter.emit('pendingRoundSettings', normalizedSettings);
    for (let player of e.players) {
      const fund = this.funds.get(player);
      if (!fund || fund < normalizedSettings.bigBlindAmount!) {
        this.updateFundOfPlayer(player, (fund ?? 0) + normalizedSettings.initialFundAmount, true);
      }
    }

    const roundData = this.getOrCreateDataForRound(e.round);
    roundData.settings = normalizedSettings;
    this.settingsByRound.set(e.round, normalizedSettings);
    this.playersByRound.set(e.round, [...e.players]);
    for (const member of this.mentalPokerGameRoom.members) {
      if (e.players.includes(member)) {
        this.sittingOutPlayers.delete(member);
      } else {
        this.sittingOutPlayers.add(member);
      }
    }
    roundData.playersOrdered.resolve(e.players);
    this.emitter.emit('roundSettings', e.round, roundData.settings);
    this.emitter.emit('players', e.round, e.players);
    roundData.initialFunds.resolve(new Map(this.funds));

    if (!replay) {
      await this.dealInitialHoleCards(e.round, e.players);
      this.scheduleHoleKeyRetry(e.round, e.players, roundData);
    }

    // Process blind bets synchronously (no await) to avoid race conditions
    // during replay, where subsequent events can interleave with async microtasks
    // and overwrite the correct whoseTurn state.
    // handleBet with isSbBbFirstBet=true has no real async operations.
    const smallBlindAmount = normalizedSettings.smallBlindAmount!;
    const bigBlindAmount = normalizedSettings.bigBlindAmount!;
    this.handleBet(e.round, smallBlindAmount, e.players[0], true);
    this.handleBet(e.round, bigBlindAmount, e.players[1], true);

    const playerNextToBb = e.players[2 % e.players.length];
    this.emitWhoseTurn(e.round, roundData, playerNextToBb, {
      callAmount: e.players.length === 2 ? bigBlindAmount - smallBlindAmount : bigBlindAmount,
    }, replay);

    // Arm the stall watchdog for the DEAL phase too. Until the encrypted shuffle finishes
    // (deck ready) no hole card can be dealt, so a shuffle interrupted by a refresh would
    // otherwise freeze here with nothing watching it. pokeCryptoProgress now treats "deck
    // not ready" as a pending reveal, so this arms the watchdog; a deck that resolves
    // normally (every healthy hand) disarms it the moment the first card decrypts.
    this.pokeCryptoProgress(e.round, roundData);
  }

  private handleUpdateSettingsEvent(e: UpdateSettingsEvent) {
    const fallbackStartRound = this.round || 1;
    const normalizedSettings = normalizeRoundSettings(e.settings, fallbackStartRound);
    this.pendingRoundSettings = normalizedSettings;
    this.emitter.emit('pendingRoundSettings', normalizedSettings);
  }

  private async dealInitialHoleCards(round: number, players: string[]) {
    // [0] to [4] are the board cards, hole cards start from [5].
    // Re-sending these private decrypt-key events is safe: each event carries
    // the same per-card key and Deferred resolution is idempotent.
    for (let i = 0; i < players.length; ++i) {
      const holeOffsets = [
        i * 2 + 5,
        i * 2 + 6,
      ];

      await this.mentalPokerGameRoom.dealCard(round, holeOffsets[0], players[i]);
      await this.mentalPokerGameRoom.dealCard(round, holeOffsets[1], players[i]);
    }
  }

  private async dealHoleCardsToPlayer(round: number, players: string[], player: string) {
    const playerOffset = players.indexOf(player);
    if (playerOffset < 0) {
      return;
    }
    const holeOffsets = [
      playerOffset * 2 + 5,
      playerOffset * 2 + 6,
    ];
    await this.mentalPokerGameRoom.dealCard(round, holeOffsets[0], player);
    await this.mentalPokerGameRoom.dealCard(round, holeOffsets[1], player);
  }

  private scheduleHoleKeyRetry(round: number, players: string[], roundData: TexasHoldemRound, attempt = 0) {
    const delayMs = HOLE_KEY_RETRY_DELAYS_MS[attempt];
    if (delayMs === undefined || roundData.result || this.areLocalInitialHoleCardsKnown(players, roundData)) {
      return;
    }
    const timer = setTimeout(() => {
      this.holeKeyRetryTimers.delete(timer);
      if (roundData.result || this.areLocalInitialHoleCardsKnown(players, roundData)) {
        return;
      }
      void this.dealInitialHoleCards(round, players)
        .catch(error => {
          console.warn(`Unable to retry initial hole key delivery for round ${round}.`, error);
        })
        .finally(() => {
          this.scheduleHoleKeyRetry(round, players, roundData, attempt + 1);
        });
    }, delayMs);
    this.holeKeyRetryTimers.add(timer);
  }

  private areLocalInitialHoleCardsKnown(players: string[], roundData: TexasHoldemRound) {
    const peerId = this.peerId;
    if (!peerId) {
      return true;
    }
    const playerOffset = players.indexOf(peerId);
    if (playerOffset < 0) {
      return true;
    }
    const firstOffset = playerOffset * 2 + 5;
    const secondOffset = playerOffset * 2 + 6;
    return roundData.knownCardValues.has(firstOffset) && roundData.knownCardValues.has(secondOffset);
  }

  private async handleBetEvent(e: BetEvent, who: string, replay: boolean) {
    await this.handleBet(e.round, e.amount, who, false, replay);
  }

  private async handleAutoFoldEvent(e: AutoFoldEvent, replay: boolean) {
    const round = this.getOrCreateDataForRound(e.round);
    if (!this.canAutoFold(round, e.target, replay)) {
      return;
    }
    // A thinking-timeout just folds THIS hand — the player keeps their seat and is
    // dealt into the next hand normally (no sit-out, no "re-seat" kick). Otherwise a
    // single timeout at a 2-player table would leave only one seated player and the
    // table could never start the next hand.
    await this.handleFold(e.round, e.target, replay);
  }

  private async handleSitOutEvent(e: SitOutEvent, who: string, replay: boolean) {
    if (typeof e.round !== 'number') {
      this.sittingOutPlayers.add(who);
      return;
    }
    const round = this.getOrCreateDataForRound(e.round);
    this.sittingOutPlayers.add(who);
    if (round.result) {
      return;
    }
    const players = await round.playersOrdered.promise;
    if (!players.includes(who)) {
      return;
    }
    await this.handleFold(e.round, who, replay);
  }

  private async handleReturnToTableEvent(e: ReturnToTableEvent, who: string, replay: boolean) {
    const roundNo = typeof e.round === 'number' ? e.round : undefined;
    const round = roundNo ? this.dataByRounds.get(roundNo) : undefined;
    const players = round ? await round.playersOrdered.promise : [];
    const returnOnlyForNextHand = Boolean(
      round
      && !round.result
      && players.includes(who)
      && !round.foldPlayers.has(who)
    );
    if (returnOnlyForNextHand && round && !replay) {
      await this.resendVisibleCardsForReturnedPlayer(roundNo!, round, who);
    }
    if (returnOnlyForNextHand && round) {
      // Resume (do NOT sit out) when the returning player still has a live stake in
      // the action and has not missed any decision:
      //   • it is their turn (they disconnected on their own turn and reopened), or
      //   • they are ALL-IN — there is no pending decision for them; the hand is only
      //     waiting on the board reveal + showdown. Sitting an all-in player out and
      //     re-pausing would strand the showdown until the 30s stall watchdog voids
      //     it (the "refresh while all-in freezes for ~30s" bug).
      if (round.currentTurn === who || round.allInPlayers.has(who)) {
        this.sittingOutPlayers.delete(who);
        round.disconnectedPlayers.delete(who);
        if (round.pausedMissingPlayers.includes(who)) {
          this.removeReturnedPlayerFromPause(roundNo!, round, who);
        } else if (round.currentTurn === who) {
          const actionMeta = this.whoseTurnByRound.get(roundNo!);
          this.emitWhoseTurn(roundNo!, round, who, actionMeta ? {callAmount: actionMeta.callAmount} : undefined);
        }
        // FAST RECOVERY for an all-in player rejoining: it has no decision left — the hand
        // is only waiting on the board reveal + showdown. Promptly (re)publish OUR board keys
        // (anti-cheat-safe: only our own decryption keys) so the board runs out in ~1-2s via
        // the fast key-retry chain, instead of stalling until the 12s crypto-stall watchdog.
        // Covers the timing where both were already all-in BEFORE this player reconnected, so
        // the live betting-completion never re-fires the reveal on the returned client.
        if (!replay && round.allInPlayers.has(who) && !round.result) {
          await this.resumePendingCardDisclosure(roundNo!, round);
        }
        return;
      }
      this.sittingOutPlayers.add(who);
      if (round.currentTurn === who) {
        this.clearTurnTimer(round);
      }
      if (round.disconnectedPlayers.has(who) && !round.pausedMissingPlayers.includes(who)) {
        round.pausedMissingPlayers.push(who);
        this.clearTurnTimer(round);
        this.publishPauseState(roundNo!, round);
      }
      return;
    }
    if (round?.foldPlayers.has(who)) {
      await this.revealFoldedPlayerRecoveryCards(roundNo!, round, who, replay);
    }
    this.sittingOutPlayers.delete(who);
    if (round?.pausedMissingPlayers.includes(who)) {
      this.removeReturnedPlayerFromPause(roundNo!, round, who, !returnOnlyForNextHand);
    }
    if (round && !round.result && !replay) {
      await this.resendVisibleCardsForReturnedPlayer(roundNo!, round, who);
      await this.resumePendingCardDisclosure(roundNo!, round, true);
    }
  }

  private handleOpenRegistrationEvent() {
    this.sittingOutPlayers.clear();
  }

  private handleMembersChanged(_members: string[]) {
    if (!this.round) {
      return;
    }
    const roundData = this.dataByRounds.get(this.round);
    if (!roundData || roundData.result) {
      return;
    }
    this.refreshPauseState(this.round, roundData);
  }

  private refreshPauseState(roundNo: number, roundData: TexasHoldemRound) {
    void roundData.playersOrdered.promise.then(async players => {
      if (roundData.result) {
        this.clearPauseGraceTimer(roundData);
        this.clearPauseState(roundNo, roundData);
        return;
      }
      const connected = new Set(this.mentalPokerGameRoom.members);

      // A player who is back online must no longer count as disconnected.
      // `disconnectedPlayers` used to be add-only, so a single refresh or brief
      // network blip kept the hand paused forever even after the player returned.
      // Now we drop reconnected players from the set and resend their still-private
      // cards, so the hand resumes the moment everyone is back.
      const reconnectedPlayers = players.filter(player =>
        roundData.disconnectedPlayers.has(player) && connected.has(player)
      );
      for (const player of reconnectedPlayers) {
        roundData.disconnectedPlayers.delete(player);
      }

      const missingPlayers = players.filter(player =>
        !connected.has(player)
        && !roundData.foldPlayers.has(player)
      );
      missingPlayers.forEach(player => roundData.disconnectedPlayers.add(player));

      // Re-deliver each returned player's hole cards and the current board. Other
      // present peers run this too, so a reconnecting player collects every peer's
      // decrypt-key share again. Re-sending these keys is idempotent
      // (see dealInitialHoleCards / revealBoardCards).
      for (const player of reconnectedPlayers) {
        if (!roundData.result) {
          await this.resendVisibleCardsForReturnedPlayer(roundNo, roundData, player);
        }
      }

      const stillMissing = players.filter(player =>
        roundData.disconnectedPlayers.has(player)
        && !roundData.foldPlayers.has(player)
      );

      if (stillMissing.length === 0) {
        this.clearPauseGraceTimer(roundData);
        this.clearPauseState(roundNo, roundData);
        return;
      }

      roundData.pausedMissingPlayers = stillMissing;
      this.clearTurnTimer(roundData);
      this.publishPauseState(roundNo, roundData);
    });
  }

  private clearPauseState(roundNo: number, roundData: TexasHoldemRound, resumePlay = true) {
    this.clearPauseGraceTimer(roundData);
    // The pause is over — the backstop heartbeat has nothing left to reconcile.
    this.stopPresenceReconcile();
    if (!roundData.pausedMissingPlayers.length && !this.handPauseByRound.has(roundNo)) {
      return;
    }
    roundData.pausedMissingPlayers = [];
    roundData.voidVotes.clear();
    this.handPauseByRound.delete(roundNo);
    this.emitter.emit('handPause', null);
    if (!resumePlay) {
      return;
    }
    if (roundData.currentTurn && !roundData.result) {
      const actionMeta = this.whoseTurnByRound.get(roundNo);
      this.emitWhoseTurn(
        roundNo,
        roundData,
        roundData.currentTurn,
        actionMeta ? {callAmount: actionMeta.callAmount} : undefined,
      );
    }
    void this.resumePendingCardDisclosure(roundNo, roundData);
  }

  // Start the pause-only presence heartbeat (idempotent). Called whenever a pause is
  // (re)published so the backstop is armed for exactly as long as the table is paused.
  private startPresenceReconcile() {
    if (this.presenceReconcileTimer) {
      return;
    }
    const timer = setInterval(() => this.reconcilePresence(), this.presenceReconcileMs);
    // Never keep a (Node) test process alive just for this heartbeat.
    (timer as unknown as { unref?: () => void }).unref?.();
    this.presenceReconcileTimer = timer;
  }

  private stopPresenceReconcile() {
    if (this.presenceReconcileTimer) {
      clearInterval(this.presenceReconcileTimer);
      this.presenceReconcileTimer = undefined;
    }
    this.lastReconciledMembersKey = '';
  }

  // One heartbeat tick: re-judge presence from the LIVE mesh member set so a side
  // that missed the 'members' reconnect event still recovers. Self-terminating —
  // stops itself the moment there is nothing left to reconcile.
  private reconcilePresence() {
    const roundData = this.round ? this.dataByRounds.get(this.round) : undefined;
    const pendingPause = Boolean(
      roundData
      && !roundData.result
      && (roundData.pausedMissingPlayers.length > 0 || roundData.disconnectedPlayers.size > 0)
    );
    if (!roundData || !pendingPause) {
      this.stopPresenceReconcile();
      return;
    }

    const liveMembers = this.mentalPokerGameRoom.members ?? [];
    const connected = new Set(liveMembers);

    // (1) Refresh the seat view. The browser seat reducer only recomputes on a
    // 'members' event, so re-announce the live set WHEN IT CHANGED to un-stick a
    // stale "对方已断线/观战" view even if the original event never arrived.
    const key = Array.from(connected).sort().join(',');
    if (key !== this.lastReconciledMembersKey) {
      this.lastReconciledMembersKey = key;
      this.emitter.emit('members', [...liveMembers]);
    }

    // (2) Un-stick the pause. If anyone we are waiting on is reachable again, re-judge
    // the pause from the live set (refreshPauseState is idempotent — it clears the
    // pause and resumes play once everyone is back). Gated on an ACTUAL reconnect so
    // an ongoing genuine pause is left untouched (no per-tick handPause churn).
    const anyReconnected =
      roundData.pausedMissingPlayers.some(player => connected.has(player))
      || Array.from(roundData.disconnectedPlayers).some(player => connected.has(player));
    if (anyReconnected) {
      this.refreshPauseState(this.round, roundData);
    }
  }

  private removeReturnedPlayerFromPause(roundNo: number, roundData: TexasHoldemRound, who: string, resumeWhenCleared = true) {
    roundData.pausedMissingPlayers = roundData.pausedMissingPlayers.filter(player => player !== who);
    roundData.voidVotes.delete(who);
    if (roundData.pausedMissingPlayers.length === 0) {
      this.clearPauseState(roundNo, roundData, resumeWhenCleared);
      return;
    }
    this.publishPauseState(roundNo, roundData);
  }

  private async foldReturnedPlayerIntoRail(roundNo: number, roundData: TexasHoldemRound, who: string, replay: boolean) {
    if (roundData.result || roundData.foldPlayers.has(who)) {
      return;
    }
    const wasCurrentTurn = roundData.currentTurn === who;
    if (wasCurrentTurn) {
      this.clearTurnTimer(roundData);
      roundData.currentTurn = null;
    }
    roundData.foldPlayers.add(who);
    this.emitter.emit('fold', roundNo, who);
    await this.revealFoldedPlayerRecoveryCards(roundNo, roundData, who, replay);

    const playersLeft = (await roundData.playersOrdered.promise).filter(p => !roundData.foldPlayers.has(p));
    if (playersLeft.length === 1) {
      const winner = playersLeft[0];
      const result: LastOneWins = {
        how: 'LastOneWins',
        round: roundNo,
        winner,
      };
      roundData.result = result;
      this.clearTurnTimer(roundData);
      this.winnersByRound.set(roundNo, result);
      this.emitter.emit('winner', result);
      const totalPotAmount = Array.from(roundData.pot.values()).reduce((m1, m2) => m1 + m2, 0);
      const newFundOfWinner = (this.funds.get(winner) ?? 0) + totalPotAmount;
      this.updateFundOfPlayer(winner, newFundOfWinner);
      return;
    }

    if (roundData.pausedMissingPlayers.length > 0) {
      this.publishPauseState(roundNo, roundData);
      return;
    }
    if (wasCurrentTurn) {
      await this.continueUnlessAllSet(roundNo, roundData, who, replay);
      return;
    }
    if (roundData.currentTurn) {
      const actionMeta = this.whoseTurnByRound.get(roundNo);
      this.emitWhoseTurn(
        roundNo,
        roundData,
        roundData.currentTurn,
        actionMeta ? {callAmount: actionMeta.callAmount} : undefined,
        replay,
      );
    }
  }

  private async resumePendingCardDisclosure(roundNo: number, roundData: TexasHoldemRound, skipBoardReveal = false) {
    if (roundData.result) {
      return;
    }
    const visibleCount = this.visibleBoardCountForStage(roundData.stage);
    if (!skipBoardReveal && (visibleCount === 3 || visibleCount === 4 || visibleCount === 5)) {
      await this.revealBoardCards(roundNo, roundData, visibleCount);
    }
    if (roundData.showdownReady) {
      await this.showdown(roundNo, roundData);
    }
  }

  private async resendVisibleCardsForReturnedPlayer(roundNo: number, roundData: TexasHoldemRound, who: string) {
    const players = await roundData.playersOrdered.promise;
    if (!roundData.foldPlayers.has(who)) {
      await this.dealHoleCardsToPlayer(roundNo, players, who);
    }
    const visibleCount = this.visibleBoardCountForStage(roundData.stage);
    if (visibleCount === 3 || visibleCount === 4 || visibleCount === 5) {
      await this.revealBoardCards(roundNo, roundData, visibleCount, false, true);
    }
  }

  private getPauseVoters(roundData: TexasHoldemRound, players: string[]) {
    const connected = new Set(this.mentalPokerGameRoom.members);
    const missing = new Set(roundData.pausedMissingPlayers);
    return players.filter(player => connected.has(player) && !missing.has(player));
  }

  private publishPauseState(roundNo: number, roundData: TexasHoldemRound) {
    void roundData.playersOrdered.promise.then(players => {
      if (!roundData.pausedMissingPlayers.length || roundData.result) {
        return;
      }
      // Record the (one-time) unlock time so the UI can show when the manual void
      // vote becomes available. No timer fires — the hand waits indefinitely.
      this.schedulePauseGraceVoidVote(roundNo, roundData);
      const voters = this.getPauseVoters(roundData, players);
      const approvals = voters.filter(player => roundData.voidVotes.get(player) === true);
      const rejections = voters.filter(player => roundData.voidVotes.get(player) === false);
      const state: HandPauseState = {
        round: roundNo,
        missingPlayers: [...roundData.pausedMissingPlayers],
        voters,
        approvals,
        rejections,
        voidUnlockAtMs: roundData.pauseGraceDeadlineMs,
      };
      this.handPauseByRound.set(roundNo, state);
      this.emitter.emit('handPause', state);
      // Arm the backstop heartbeat for as long as this pause stands, so a side that
      // missed the opponent's reconnect 'members' event still recovers on its own.
      this.startPresenceReconcile();
    });
  }

  // No timer ever auto-voids: a paused hand waits indefinitely. This only records
  // when the manual "void & refund" vote unlocks (pauseStart + VOID_VOTE_UNLOCK_MS),
  // set ONCE so the unlock time doesn't slide forward on each pause republish.
  private schedulePauseGraceVoidVote(_roundNo: number, roundData: TexasHoldemRound) {
    if (roundData.result || !roundData.pausedMissingPlayers.length) {
      return;
    }
    if (roundData.pauseGraceDeadlineMs === undefined) {
      roundData.pauseGraceDeadlineMs = Date.now() + this.pauseGraceVoidMs;
    }
  }

  private clearPauseGraceTimer(roundData: TexasHoldemRound) {
    roundData.pauseGraceDeadlineMs = undefined;
  }

  // Stall watchdog REMOVED. A disconnect / stuck reveal now PAUSES the table and
  // waits INDEFINITELY (permanent wait) — nothing ever auto-voids. The only early
  // exit is the unanimous manual "void & refund" vote, which unlocks after
  // VOID_VOTE_UNLOCK_MS. Kept as no-ops so the reveal/showdown call sites stay
  // unchanged.
  // Reset-and-arm the per-round stall watchdog. Called on every decrypted card (progress) and
  // whenever a reveal becomes pending. Only arms while a reveal is genuinely outstanding; fires
  // CRYPTO_STALL_MS after the LAST progress, meaning the reveal is stuck.
  private pokeCryptoProgress(round: number, roundData: TexasHoldemRound) {
    const existing = this.cryptoStallTimers.get(round);
    if (existing) {
      clearTimeout(existing);
      this.cryptoStallTimers.delete(round);
    }
    if (roundData.result) {
      return;
    }
    const needed = this.visibleBoardCountForStage(roundData.stage);
    const boardComplete = (this.boardByRound.get(round)?.length ?? 0) >= needed;
    // The deal phase counts as a pending reveal: until the encrypted shuffle finishes the
    // deck is not ready and no card can be dealt, so an interrupted shuffle must be watched
    // exactly like a stuck board reveal. A healthy deck resolves in well under the stall
    // window, so this never fires on a normal hand.
    const deckReady = this.mentalPokerGameRoom.isDeckReadyForRound?.(round) ?? true;
    const revealPending = !boardComplete || roundData.showdownReady || !deckReady;
    if (!revealPending) {
      return;
    }
    const timer = setTimeout(() => {
      this.cryptoStallTimers.delete(round);
      void this.handleCryptoStall(round, roundData);
    }, CRYPTO_STALL_MS);
    this.cryptoStallTimers.set(round, timer);
  }

  // The reveal made no progress for CRYPTO_STALL_MS. If THIS client genuinely cannot finish the
  // hand — it does not hold the per-card keys for this round (the degraded post-refresh / cleared-
  // storage state) — declare it unfinishable. The cannotContinue handler then resolves the table
  // (void if a peer is gone; treat as this client folding if everyone is connected, since a fold-
  // win needs no board). Gated so only a non-folded participant who actually lacks its keys
  // declares — a client that DOES hold its keys keeps waiting (the stuck side is the other one),
  // and a hand that resolved or progressed never reaches here.
  private async handleCryptoStall(round: number, roundData: TexasHoldemRound) {
    if (roundData.result || this.activeEventReplay) {
      return;
    }
    // Deal phase stalled: the encrypted shuffle never finished — the deck is still not
    // ready CRYPTO_STALL_MS after the hand started. This is the mid-shuffle-refresh
    // deadlock: a refresh interrupted the shuffle, its partial events are skipped on
    // replay, and no deck/finalized is ever produced, so the deck can never resolve and
    // no card can be dealt. The hand is objectively unfinishable, so declare it — the
    // table voids and re-deals cleanly instead of freezing forever. Only a participant
    // declares; board-reveal stalls fall through to the existing logic below.
    const deckReady = this.mentalPokerGameRoom.isDeckReadyForRound?.(round) ?? true;
    if (!deckReady) {
      const myId = await this.gameRoom.peerIdAsync;
      const dealtPlayers = this.playersByRound.get(round) ?? await roundData.playersOrdered.promise;
      if (dealtPlayers.includes(myId)) {
        console.warn(`Deal stalled for round ${round}; declaring cannotContinue (encrypted shuffle never finished — interrupted by a refresh).`);
        await this.declareCannotContinue(round);
      }
      return;
    }
    const needed = this.visibleBoardCountForStage(roundData.stage);
    const boardComplete = (this.boardByRound.get(round)?.length ?? 0) >= needed;
    if (boardComplete && !roundData.showdownReady) {
      return;
    }
    const myId = await this.gameRoom.peerIdAsync;
    const players = await roundData.playersOrdered.promise;
    const iAmLiveParticipant = players.includes(myId) && !roundData.foldPlayers.has(myId);

    const hasKeys = this.mentalPokerGameRoom.hasIndividualKeysForRound?.(round) ?? true;
    if (hasKeys) {
      // I hold my per-card keys but the board reveal is stuck. The OLD behaviour was to do
      // nothing here and assume the OTHER player is the stuck side — but that DEADLOCKS the
      // table when the stuck side is actually ME failing to (re)publish my board keys. That
      // is exactly the live "all-in + refresh on my turn → I go all-in → board never runs
      // out" bug: after a reconnect the all-in completion is only ever seen during the relay
      // REPLAY (where board reveal is skipped to avoid double-publishing), the settle
      // re-trigger can miss it, and `revealBoardCards` is never called live — so my board
      // keys never go out even though I hold them. Re-publishing my OWN decryption keys is
      // anti-cheat-safe (it reveals nothing I'm not supposed to reveal), so force it: the
      // opponent already published theirs, so my keys complete the board and the hand
      // resolves. Re-arm the watchdog to retry if it is somehow still stuck.
      if (iAmLiveParticipant) {
        const target = (roundData.showdownReady ? 5 : Math.max(needed, 3)) as 3 | 4 | 5;
        try {
          await this.revealBoardCards(round, roundData, target, false, true, true);
          this.tryResolveShowdown(round, roundData);
        } catch (error) {
          console.warn(`Forced board-key republish failed for round ${round}.`, error);
        }
        this.pokeCryptoProgress(round, roundData);
      }
      return;
    }

    if (!iAmLiveParticipant) {
      return;
    }
    console.warn(`Crypto reveal stalled for round ${round}; declaring cannotContinue (this client lacks its keys).`);
    await this.declareCannotContinue(round);
  }

  private clearStallWatchdog(_roundData: TexasHoldemRound) {}

  private async handleVoidHandVoteEvent(e: VoidHandVoteEvent, who: string) {
    const roundData = this.dataByRounds.get(e.round);
    if (!roundData || roundData.result || !roundData.pausedMissingPlayers.length) {
      return;
    }
    const players = await roundData.playersOrdered.promise;
    const voters = this.getPauseVoters(roundData, players);
    if (!voters.includes(who)) {
      return;
    }
    // Only "void & refund" votes count — there is no "keep waiting" vote anymore
    // (waiting is the default). The 15-minute unlock is enforced by the disabled
    // button client-side; the engine simply tallies agreement.
    if (e.approve !== true) {
      return;
    }
    roundData.voidVotes.set(who, true);

    // Void only when EVERY still-seated player has agreed (unanimous).
    const approvals = voters.filter(player => roundData.voidVotes.get(player) === true);
    if (voters.length > 0 && approvals.length === voters.length) {
      this.voidHand(e.round, roundData, approvals);
      return;
    }
    this.publishPauseState(e.round, roundData);
  }

  private async handleCannotContinueEvent(e: CannotContinueEvent, who: string, replay: boolean) {
    const roundData = this.dataByRounds.get(e.round);
    if (!roundData || roundData.result) {
      return;
    }
    const players = await roundData.playersOrdered.promise;
    // Only a player actually dealt into this hand can declare it unfinishable; a
    // spectator's claim is ignored. Re-checked here even though rejoinActiveHand
    // already gates it, so a malformed or forged event can never void a live hand.
    if (!players.includes(who)) {
      return;
    }
    // The hand can no longer be completed — either the declarer lost their own
    // per-card keys (reopened with cleared storage), or a board reveal/showdown
    // stalled because some participant can never publish a needed decrypt key. This
    // is a cryptographic fact, not a vote, so void immediately and deterministically:
    // every client that receives this event reaches the same outcome (no "one
    // resumes, others void" disagreement). Chips are refunded and the table ends.
    // The "missing" set (informational on the voided result) is whoever the table
    // can no longer get decrypt contributions from: any disconnected participant,
    // or — when everyone is still connected but the declarer lost their own keys —
    // the declarer themselves.
    const connected = new Set(this.mentalPokerGameRoom.members);
    const disconnected = players.filter(player => !connected.has(player));
    // Gate (Audit V8): a cannotContinue only voids the whole table when the hand is
    // GENUINELY unfinishable — some participant is actually disconnected, or the
    // hand was already paused waiting on a missing player (the classic "dropped and
    // reopened without my keys" recovery). A fully-connected player on a hand that
    // never paused still holds its per-card keys (they persist for the live hand),
    // so a cannotContinue from them is an attempt to dodge a losing hand and claw
    // every chip back through the refund. Treat it as an ordinary fold instead: the
    // board can still be revealed (the folder keeps its keys), so the hand finishes
    // normally and the loss stands, while genuine disconnect recovery is untouched.
    // The deal phase has no real wager on the line — only the blinds — and no hole cards
    // exist yet. A cannotContinue while the deck is NOT ready means the deal could never
    // complete (e.g. a refresh interrupted the encrypted shuffle, so the deck never
    // resolved). Void it, never treat it as a fold: "folding" is meaningless with no cards,
    // and with nothing but the symmetric blinds in there is no losing hand to dodge (the V8
    // anti-dodge fold guards only the post-deal phase, where the deck IS ready). Sit out
    // only players who actually disconnected; if everyone is still connected NOBODY sits out
    // and both keep playing the re-dealt hand — sitting out the declarer would wrongly drop
    // a present player and could leave too few to re-deal. The reducer's resolvePendingVoids
    // uses the same deck-ready test (rebuilt from the signed deck/finalized event) so engine
    // and reducer reach an identical result.
    const deckReady = this.mentalPokerGameRoom.isDeckReadyForRound?.(e.round) ?? true;
    if (!deckReady) {
      // Deal-phase void: refund the blinds and re-deal, but DO NOT sit anyone out or mark
      // anyone "gone". A mid-shuffle refresh briefly drops the refresher from the roster, yet
      // they reconnect within seconds and must keep their seat — sitting them out (or flagging
      // them as having "left") wrongly ENDS the table over a transient refresh and shows a
      // scary "a player left for good" notice. With nobody sat out, the next hand simply
      // re-deals to whoever is present (a genuinely departed player is absent from the roster
      // and naturally not dealt in). missing=[] mirrors the reducer's refundVoid(…, []), so the
      // engine and the funds-truth reducer agree exactly.
      roundData.pausedMissingPlayers = [];
      this.voidHand(e.round, roundData, players);
      return;
    }
    if (disconnected.length === 0 && roundData.pausedMissingPlayers.length === 0) {
      await this.handleFold(e.round, who, replay);
      return;
    }
    const missing = disconnected.length > 0 ? disconnected : [who];
    missing.forEach(player => roundData.disconnectedPlayers.add(player));
    roundData.pausedMissingPlayers = missing;
    const approvals = players.filter(player => !missing.includes(player));
    this.voidHand(e.round, roundData, approvals);
  }

  private voidHand(roundNo: number, roundData: TexasHoldemRound, approvals: string[]) {
    for (const player of roundData.pausedMissingPlayers) {
      this.sittingOutPlayers.add(player);
    }
    // A hand that can't be finished (a player left and the deck can't be decrypted
    // without their key) is simply voided: every chip committed this hand is
    // refunded. No penalties — the table will end and everyone restarts.
    const result: VoidedHandResult = {
      how: 'Voided',
      round: roundNo,
      missingPlayers: [...roundData.pausedMissingPlayers],
      approvals,
    };
    roundData.result = result;
    this.clearTurnTimer(roundData);
    this.clearPauseGraceTimer(roundData);
    for (const [player, amount] of Array.from(roundData.pot.entries())) {
      this.updateFundOfPlayer(player, (this.funds.get(player) ?? 0) + amount);
    }
    roundData.pot.clear();
    this.potAmount = 0;
    this.emitter.emit('pot', roundNo, 0);
    this.winnersByRound.set(roundNo, result);
    this.handPauseByRound.delete(roundNo);
    this.emitter.emit('handPause', null);
    this.emitter.emit('winner', result);
  }

  // True when two different deck positions have decrypted to the same card — which
  // a legal 52-card deck can never do, so the shuffle was rigged. (Audit V4.)
  private hasDuplicateKnownCard(roundData: TexasHoldemRound): boolean {
    const seen = new Set<string>();
    for (const card of Array.from(roundData.knownCardValues.values())) {
      const key = `${card.suit}-${card.rank}`;
      if (seen.has(key)) {
        return true;
      }
      seen.add(key);
    }
    return false;
  }

  // Voids a hand whose deck is provably corrupt (a duplicated card). Everyone is
  // refunded — the rigged hand simply never happened. Deterministic for the public
  // board (identical on every client); a client that additionally sees a duplicate
  // among its own hole cards refuses the hand locally too. (Audit V4.)
  private async voidCorruptDeck(round: number, roundData: TexasHoldemRound) {
    if (roundData.result) {
      return;
    }
    console.error(`Corrupt deck in round ${round}: a card was dealt twice. Voiding the hand.`);
    const players = await roundData.playersOrdered.promise.catch(() => [] as string[]);
    roundData.pausedMissingPlayers = [];
    this.voidHand(round, roundData, players);
  }

  private clearTurnTimer(roundData: TexasHoldemRound) {
    if (roundData.currentTurnTimer) {
      clearTimeout(roundData.currentTurnTimer);
      roundData.currentTurnTimer = undefined;
    }
  }

  private async clearLocalTurnTimerForSubmittedAction(round: number) {
    const roundData = this.dataByRounds.get(round);
    if (!roundData) {
      return;
    }
    const myPeerId = await this.gameRoom.peerIdAsync;
    if (roundData.currentTurn === myPeerId) {
      this.clearTurnTimer(roundData);
    }
  }

  private emitWhoseTurn(
    round: number,
    roundData: TexasHoldemRound,
    whose: string | null,
    actionMeta?: {callAmount: number},
    replay?: boolean,
  ) {
    this.clearTurnTimer(roundData);
    const timeoutSeconds = roundData.settings?.autoFoldTimeoutSeconds;
    const timeoutMs = timeoutSeconds ? timeoutSeconds * 1000 : 0;
    // Always start the turn clock FRESH (full timeout from now), including on a
    // reconnect/replay. A reconnecting client cannot know how long an opponent's
    // turn has really been running — and if that turn was paused (someone else
    // dropped), the pause time must not count — so it must never assume the turn is
    // nearly expired and fold the active player. A genuinely idle player is still
    // folded by their OWN client (and any continuously-connected client) on the
    // real clock; the reconnecting client just gives a safe full window.
    const timerDelayMs = timeoutMs;
    roundData.currentTurn = whose;
    roundData.currentTurnStartedAtMs = whose ? Date.now() : 0;
    this.whoseTurnByRound.set(round, whose ? {whoseTurn: whose, callAmount: actionMeta?.callAmount ?? 0} : null);
    if (actionMeta) {
      this.emitter.emit('whoseTurn', round, whose, actionMeta);
    } else {
      this.emitter.emit('whoseTurn', round, whose);
    }

    if (!whose || !timeoutSeconds || roundData.result) {
      return;
    }

    const timer = setTimeout(() => {
      if (!this.canAutoFold(roundData, whose, false)) {
        return;
      }
      this.autoFold(round, whose).catch(e => console.error('Failed to auto-fold inactive player', e));
    }, timerDelayMs);
    (timer as unknown as {unref?: () => void}).unref?.();
    roundData.currentTurnTimer = timer;
  }

  private canAutoFold(roundData: TexasHoldemRound, target: string, replay: boolean) {
    if (
      roundData.result
      || roundData.currentTurn !== target
      || roundData.foldPlayers.has(target)
      || roundData.allInPlayers.has(target)
      || this.sittingOutPlayers.has(target)
    ) {
      return false;
    }
    if (replay) {
      return true;
    }
    const timeoutSeconds = roundData.settings?.autoFoldTimeoutSeconds;
    if (!timeoutSeconds || !roundData.currentTurnStartedAtMs) {
      return false;
    }
    return Date.now() - roundData.currentTurnStartedAtMs >= (timeoutSeconds * 1000) - 250;
  }

  private async handleBet(roundNo: number, raisedAmount: number, who: string, isSbBbFirstBet?: boolean, replay?: boolean) {
    // Defense in depth: reject non-finite, non-integer, or negative amounts.
    // Wire bets are schema-checked at the dispatch boundary (eventSchema), but
    // blind bets and any future caller route through here too, and a NaN amount
    // would otherwise slip past the comparisons below (NaN < x is always false)
    // and corrupt the pot. Chips are integer units, so amounts must be safe
    // integers. (Audit C14 amount validation, E02 malformed input.)
    //
    // NOTE: full poker betting rules — minimum raise (N x big blind), legal
    // all-in / side-pot boundaries, street progression — are NOT fully enforced
    // here and remain roadmap items (see AUDIT_HARDENING_STATUS.md, C14/D03).
    if (!Number.isSafeInteger(raisedAmount) || raisedAmount < 0) {
      console.warn(`Bet amount must be a non-negative integer: ${raisedAmount}`);
      return;
    }

    const fund = this.funds.get(who) ?? 0;
    if (fund < raisedAmount) {
      console.warn(`Fund is insufficient: ${fund}`);
      return;
    }

    const round = this.getOrCreateDataForRound(roundNo);
    if (round.result) {
      console.warn(`Cannot bet since this round has ended.`);
      return;
    }
    if (!isSbBbFirstBet && round.pausedMissingPlayers.length > 0) {
      console.warn(`Cannot bet while the hand is paused.`);
      return;
    }
    if (!isSbBbFirstBet && round.currentTurn !== who) {
      console.warn(`Ignoring bet from ${who}; current turn is ${round.currentTurn ?? 'none'}.`);
      return;
    }
    const pot = round.pot;
    const currentBetAmount = pot.get(who) ?? 0;
    const leastTotalBetAmount = Array.from(pot.values()).reduce((a, b) => Math.max(a, b), 0);
    const totalBetAmount = currentBetAmount + raisedAmount;
    const allin = fund === raisedAmount;
    if (totalBetAmount < leastTotalBetAmount && !allin) { // if less but not all-in
      console.warn(`Cannot bet ${raisedAmount} addition to ${currentBetAmount} because the least bet amount is ${leastTotalBetAmount}.`);
      return;
    }

    if (!isSbBbFirstBet) {
      if (totalBetAmount === leastTotalBetAmount) {
        // call or check
        round.calledPlayers.add(who);
      } else {
        // raise
        round.calledPlayers.clear();
        round.calledPlayers.add(who);
      }
    }

    if (allin) {
      round.allInPlayers.add(who);
    }

    pot.set(who, totalBetAmount);
    this.updateFundOfPlayer(who, fund - raisedAmount);

    this.emitter.emit('bet', roundNo, raisedAmount, who, allin);
    const potTotalAmount = Array.from(round.pot.values()).reduce((a, b) => a + b, 0);
    this.potAmount = potTotalAmount;
    this.emitter.emit('pot', roundNo, potTotalAmount);

    if (!isSbBbFirstBet) {
      if (round.currentTurn === who) {
        this.clearTurnTimer(round);
        round.currentTurn = null;
      }
      await this.continueUnlessAllSet(roundNo, round, who, !!replay);
    }
  }

  private async handleFoldEvent(e: FoldEvent, who: string, replay: boolean) {
    await this.handleFold(e.round, who, replay);
  }

  private async handleFold(roundNo: number, who: string, replay: boolean) {
    const round = this.getOrCreateDataForRound(roundNo);
    if (round.result) {
      return;
    }
    if (round.pausedMissingPlayers.length > 0 && !round.pausedMissingPlayers.includes(who)) {
      return;
    }
    if (round.foldPlayers.has(who)) {
      return;
    }
    if (round.currentTurn === who) {
      this.clearTurnTimer(round);
      round.currentTurn = null;
    }
    round.foldPlayers.add(who);
    this.emitter.emit('fold', roundNo, who);

    const playersLeft = (await round.playersOrdered.promise).filter(p => !round.foldPlayers.has(p));
    if (playersLeft.length === 1) {
      // last one wins
      const winner = playersLeft[0];
      const result: LastOneWins = {
        how: 'LastOneWins',
        round: roundNo,
        winner,
      };
      round.result = result;
      this.clearTurnTimer(round);
      this.winnersByRound.set(roundNo, result);
      this.emitter.emit('winner', result);
      const totalPotAmount = Array.from(round.pot.values()).reduce((m1, m2) => m1 + m2, 0);
      const newFundOfWinner = (this.funds.get(winner) ?? 0) + totalPotAmount;
      this.updateFundOfPlayer(winner, newFundOfWinner);
    } else {
      await this.revealFoldedPlayerRecoveryCards(roundNo, round, who, replay);
      await this.continueUnlessAllSet(roundNo, round, who, replay);
    }
  }

  private async revealFoldedPlayerRecoveryCards(
    roundNo: number,
    round: TexasHoldemRound,
    foldedPlayer: string,
    replay: boolean,
  ) {
    if (replay) {
      return;
    }
    const myPeerId = await this.gameRoom.peerIdAsync;
    if (foldedPlayer !== myPeerId) {
      return;
    }

    const players = await round.playersOrdered.promise;
    const activePlayers = players.filter(player => !round.foldPlayers.has(player));
    if (activePlayers.length < 2) {
      return;
    }

    const offsets = new Set<number>([0, 1, 2, 3, 4]);
    players.forEach((player, playerOffset) => {
      if (round.foldPlayers.has(player)) {
        return;
      }
      offsets.add(playerOffset * 2 + 5);
      offsets.add(playerOffset * 2 + 6);
    });

    for (const offset of Array.from(offsets).sort((a, b) => a - b)) {
      await this.mentalPokerGameRoom.showCard(roundNo, offset);
    }
  }

  private updateFundOfPlayer(whose: string, amount: number, borrowed?: boolean) {
    const previousAmount = this.funds.get(whose);
    this.funds.set(whose, amount);
    this.emitter.emit('fund', amount, previousAmount, whose, borrowed);
  }

  // Seed carried chip balances from the funds-checkpoint the React hook persists
  // between hands (localStorage `fairpoker:funds-checkpoint:<tableId>`). After a
  // refresh/reconnect the relay only replays the CURRENT hand, so without this the
  // engine's `funds` would be empty and handleNewRoundEvent would top a returning
  // player back up to the INITIAL buy-in — discarding the winnings/rebuys they
  // carried in. Their all-in (sized from the correct displayed stack) would then
  // exceed the engine's stale fund, get rejected as "Fund is insufficient", silently
  // drop the bet, never reach showdown, and DEADLOCK the hand (the live "all-in after
  // refresh freezes" bug). The display already restores these via the reducer; this
  // keeps the engine's betting logic consistent. Best-effort and per-table-scoped, so
  // a fresh table (no checkpoint) or a test harness (mock room, no tableId) is a no-op.
  private restoreFundsFromCheckpoint() {
    try {
      const tableId = (this.gameRoom as { expectedTableId?: string }).expectedTableId;
      if (!tableId || typeof localStorage === 'undefined') {
        return;
      }
      const raw = localStorage.getItem(`fairpoker:funds-checkpoint:${tableId}`);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.funds)) {
        return;
      }
      // Remember the round the checkpoint already accounts for, so replayed events for
      // rounds at or before it are NOT re-applied on top of the seeded balances (which
      // would double-count an earlier hand's winnings and corrupt the stack — the cause
      // of the "all-in after refresh still stalls intermittently" follow-up).
      if (Number.isSafeInteger(parsed.throughRound)) {
        this.fundsCheckpointThroughRound = parsed.throughRound;
      }
      for (const entry of parsed.funds) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && Number.isFinite(entry[1]) && entry[1] >= 0) {
          if (!this.funds.has(entry[0])) {
            this.funds.set(entry[0], entry[1]);
          }
        }
      }
    } catch {
      // Missing/corrupt checkpoint: fall back to the replay seeding (best-effort).
    }
  }

  private async continueUnlessAllSet(round: number, roundData: TexasHoldemRound, whosePreviousTurn: string, replay?: boolean) {
    const players = await roundData.playersOrdered.promise;

    const prevOffset = players.findIndex(p => p === whosePreviousTurn);
    const whoseTurnNext = [...players.slice(prevOffset + 1), ...players.slice(0, prevOffset)]
      .find(player =>
        !roundData.allInPlayers.has(player) &&
        !roundData.calledPlayers.has(player) &&
        !roundData.foldPlayers.has(player));

    if (!whoseTurnNext) {
      const everyOneElseIsAllinOrFolds = (players.length - roundData.allInPlayers.size - roundData.foldPlayers.size) <= 1;
      roundData.calledPlayers.clear();
      this.emitter.emit('allSet', round);
      this.emitWhoseTurn(round, roundData, null, undefined, replay);
      const shouldShowdown = everyOneElseIsAllinOrFolds || roundData.stage === Stage.RIVER;
      if (shouldShowdown) {
        roundData.showdownReady = true;
        this.tryResolveShowdown(round, roundData);
      }

      const nextVisibleBoardCount: 3 | 4 | 5 | null = (() => {
        switch (roundData.stage) {
          case Stage.PRE_FLOP:
            return everyOneElseIsAllinOrFolds ? 5 : 3;
          case Stage.FLOP:
            return everyOneElseIsAllinOrFolds ? 5 : 4;
          case Stage.TURN:
            return 5;
          case Stage.RIVER:
            return null;
        }
      })();

      if (nextVisibleBoardCount !== null) {
        await this.revealBoardCards(round, roundData, nextVisibleBoardCount, replay);
      }

      if (!replay && shouldShowdown) {
        await this.showdown(round, roundData);
      }

      if (!everyOneElseIsAllinOrFolds && !shouldShowdown) {
        this.emitWhoseTurn(
          round,
          roundData,
          players.find(player => !roundData.allInPlayers.has(player) && !roundData.foldPlayers.has(player)) || null,
          {callAmount: 0},
          replay);
      }
    } else {
      const pot = roundData.pot;
      const currentBetAmount = pot.get(whoseTurnNext) ?? 0;
      const leastTotalBetAmount = Array.from(pot.values()).reduce((a, b) => Math.max(a, b), 0);
      const callAmount = leastTotalBetAmount - currentBetAmount;
      this.emitWhoseTurn(round, roundData, whoseTurnNext, {callAmount}, replay);
    }
  }

  private async showdown(round: number, roundData: TexasHoldemRound) {
    roundData.showdownReady = true;
    // A showdown is now pending — arm the stall watchdog so the hand cannot freeze
    // if a remaining player never publishes their hole-card keys.
    this.pokeCryptoProgress(round, roundData);
    const players = await roundData.playersOrdered.promise;
    for (let i = 0; i < players.length; ++i) {
      if (roundData.foldPlayers.has(players[i])) {
        continue;
      }
      const holeOffsets = [
        i * 2 + 5,
        i * 2 + 6,
      ];
      await this.mentalPokerGameRoom.showCard(round, holeOffsets[0]);
      await this.mentalPokerGameRoom.showCard(round, holeOffsets[1]);
    }
    this.tryResolveShowdown(round, roundData);
  }
}
