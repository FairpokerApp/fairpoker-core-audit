// Pure, deterministic Texas Hold'em state reducer — the single source of truth for
// the browser-authoritative rework (see app/BROWSER_AUTHORITATIVE_REWORK_PLAN.md).
//
// `reduceTexasHoldem(events, reveals, connected)` folds the ORDERED signed table-event
// log (the same log the relay sequences) plus the decrypted card reveals plus the set
// of currently-reachable peers into the full table state — pot, per-player committed
// chips, bankrolls, whose turn, street/stage, folded/all-in, seating, and the resolved
// hand result. It is PURE: no async, no timers, no Date.now, no network, and it never
// mutates state carried across calls. Same inputs ⇒ same output, on every client and in
// the verifier — which is exactly what makes a reconnecting client re-derive a state
// byte-identical to everyone else's (killing the mid-hand-refresh desync).
//
// It deliberately mirrors the existing stateful engine's BETTING math
// (`TexasHoldemGameRoom.handleBet/handleFold/continueUnlessAllSet/calculateAwards`) so
// behavior is unchanged; the `texasHoldemReducer.diff.test.ts` differential test feeds
// the real engine and this reducer the same random lines and asserts they agree.

import { evaluateStandardCards } from "../rules";
import { handRank } from "phe";
import { StandardCard } from "../secureMentalPoker";
import {
  TexasHoldemRoundSettings,
  TexasHoldemTableEvent,
  WinningResult,
  ShowdownResult,
  normalizeRoundSettings,
} from "./TexasHoldemGameRoom";
import { TranscriptSnapshot } from "../fairness/transcript";
import { isSignedGameEvent } from "../fairness/eventSigning";

// The relay's own system identity — never a player/seat (defense-in-depth; the transport
// already filters it out of the peer set).
const RELAY_SYSTEM_SENDER = 'worker-relay';

// A standard 9-max table: at most 9 players are seated for a hand. Any further peers
// stay as spectators ('watching') until a seat frees up. Capped here, in the one
// browser-authoritative seating derivation, so every client agrees on the same 9 (and
// the dealer never deals more than 9 hole-card pairs).
export const MAX_SEATS = 9;

export enum ReducerStage {
  PRE_FLOP = 0,
  FLOP = 1,
  TURN = 2,
  RIVER = 3,
}

// One hand's worth of state, derived purely from the log.
export interface ReducedRound {
  round: number;
  players: string[];
  settings: TexasHoldemRoundSettings;
  startFunds: Map<string, number>; // bankrolls after auto-rebuy, before blinds
  pot: Map<string, number>; // cumulative chips each player has committed this hand
  streetStartPot: Map<string, number>; // pot snapshot at the start of the current street
  called: Set<string>; // players who have matched the current bet this street
  folded: Set<string>;
  allIn: Set<string>;
  stage: ReducerStage;
  currentTurn: string | null;
  callAmount: number; // amount the current player must add to call
  currentTurnStartedAtRelayTs?: number; // relay clock when the current turn began (D-1 timing)
  showdownReady: boolean;
  voidApprovals: Set<string>; // dealt-in players who signed an approving voidHandVote (E-1)
  cannotContinue: Set<string>; // dealt-in players who declared the hand unfinishable (E-1)
  result?: WinningResult;
}

export type SeatStatus = 'active' | 'watching' | 'sittingOut' | 'missing' | 'offline';

export interface SeatPlayer {
  peerId: string;
  online: boolean;
  seated: boolean;
  status: SeatStatus;
}

export interface ReducedTableState {
  currentRound: number | null;
  handInProgress: boolean;
  funds: Map<string, number>; // bankrolls carried across hands
  boughtIn: Map<string, number>; // total chips a player has bought in (initial + auto-rebuys)
  rounds: Map<number, ReducedRound>;
  sittingOut: Set<string>;
  resolvedRounds: number[]; // resolved round numbers in resolution order (history)
  potAmount: number; // total chips in the current round's pot (display)
  // Seating/lifecycle view (the browser-authoritative replacement for the Worker's
  // roomState). Computed from the same log + the locally-reachable peer set.
  seated: Set<string>; // peers holding a seat (intermediate; see seatPlayers for the view)
  knownPeers: Set<string>; // every peer ever seen in the log or currently connected
  seatPlayers: SeatPlayer[]; // every known peer with a resolved seat status
  seatedForNextHand: string[]; // peers eligible to play the next hand
  seatChoices: Map<string, number>; // raw chosen seat (0..SEAT_COUNT-1) per peer, from action/takeSeat
  seatByPeer: Map<string, number>; // resolved absolute seat per seated peer (chosen, else auto-filled)
  missingPlayers: string[]; // current-hand players unreachable right now
  playable: boolean; // >= 2 seated players ⇒ a hand can start/continue
  _currentEventRelayTs?: number; // transient: relayTs of the event currently being applied (D-1)
  _connected?: Set<string>; // transient: the live reachable set (for self/away auto-fold authorization, R4·01)
}

// round -> (card offset -> decrypted card). Offsets 0..4 are the board, hole cards for
// player i are at offsets 2*i+5 and 2*i+6. These are deterministic functions of the
// mental-poker key-reveal events, so they are part of the canonical inputs.
export type CardReveals = Map<number, Map<number, StandardCard>>;

// Build the reveal map the reducer needs to award showdowns, from the public board + hole
// cards a resolved hand exposes (the same data persisted in 战绩 history, so it survives a
// refresh). Offsets follow the reducer's convention: board at 0..4, player i's hole at
// 2*i+5 / 2*i+6. Used by the live client to feed `reduceTexasHoldem` so the bankrolls it
// derives from the full transcript include showdown winnings — making the reducer the
// single source of truth for funds too, not just pot/turn. (Fold-out hands need no reveals;
// they award the last player standing directly.)
export interface RevealableHand {
  round: number;
  players: string[];
  board?: StandardCard[];
  holesPerPlayer?: Map<string, [StandardCard, StandardCard]>;
}

export function cardRevealsFromHands(hands: RevealableHand[]): CardReveals {
  const reveals: CardReveals = new Map();
  for (const hand of hands) {
    const offsets = new Map<number, StandardCard>();
    (hand.board ?? []).forEach((card: StandardCard, i: number) => {
      if (card && i < 5) offsets.set(i, card);
    });
    hand.players.forEach((player: string, i: number) => {
      const hole = hand.holesPerPlayer?.get(player);
      if (hole && hole[0] && hole[1]) {
        offsets.set(2 * i + 5, hole[0]);
        offsets.set(2 * i + 6, hole[1]);
      }
    });
    if (offsets.size > 0) {
      // Merge rather than overwrite, so a live partial reveal and a persisted full reveal
      // for the same round combine instead of clobbering.
      const existing = reveals.get(hand.round);
      if (existing) {
        for (const [k, v] of Array.from(offsets)) existing.set(k, v);
      } else {
        reveals.set(hand.round, offsets);
      }
    }
  }
  return reveals;
}

// A normalized lifecycle/table event. Mirrors the subset of TexasHoldemTableEvent the
// reducer consumes, plus the signed sender (`from`).
export interface ReducerEvent {
  type:
    | 'newRound'
    | 'action/bet'
    | 'action/fold'
    | 'action/autoFold'
    | 'action/sitOut'
    | 'action/returnToTable'
    | 'action/openRegistration'
    | 'action/voidHandVote'
    | 'action/cannotContinue'
    | 'action/takeSeat'
    | 'hand/result';
  from?: string; // signed sender
  round?: number | null;
  amount?: number;
  target?: string; // autoFold target
  players?: string[]; // newRound seat order
  settings?: TexasHoldemRoundSettings; // newRound settings
  approve?: boolean; // voidHandVote approval
  seat?: number; // takeSeat: chosen absolute seat index (purely positional; see SEAT_COUNT)
  relayTs?: number; // relay server receive-timestamp (trusted clock for auto-fold timing; D-1)
}

// A standard 9-handed table has 9 absolute seat positions (0..8). Seat choice is purely
// positional — where a player sits around the oval — and never affects dealing or turn
// order (which stay driven by the signed action log).
export const SEAT_COUNT = 9;

function emptyState(): ReducedTableState {
  return {
    currentRound: null,
    handInProgress: false,
    funds: new Map(),
    boughtIn: new Map(),
    rounds: new Map(),
    sittingOut: new Set(),
    resolvedRounds: [],
    potAmount: 0,
    seated: new Set(),
    knownPeers: new Set(),
    seatPlayers: [],
    seatedForNextHand: [],
    seatChoices: new Map(),
    seatByPeer: new Map(),
    missingPlayers: [],
    playable: false,
  };
}

function note(state: ReducedTableState, peer: string | undefined): void {
  if (peer && peer !== RELAY_SYSTEM_SENDER) state.knownPeers.add(peer);
}

function maxBet(pot: Map<string, number>): number {
  let m = 0;
  for (const v of Array.from(pot.values())) {
    if (v > m) m = v;
  }
  return m;
}

function potTotal(pot: Map<string, number>): number {
  let s = 0;
  for (const v of Array.from(pot.values())) s += v;
  return s;
}

// Side-pot aware award split. Direct port of TexasHoldemGameRoom.calculateAwards: each
// showdown tier (best first) wins from every player's contribution up to that winner's
// own committed amount; ties split the floor; the remainder returns to over-bettors.
export function calculateAwards(
  roundPot: Map<string, number>,
  showdownResult: ShowdownResult['showdown'],
): Map<string, number> {
  const pot = new Map(roundPot);
  const amountsToBeUpdated = new Map<string, number>();
  for (const result of showdownResult) {
    const winners = result.players.slice().sort((p1, p2) => (pot.get(p1) ?? 0) - (pot.get(p2) ?? 0));
    let amountUnallocated = 0;
    for (let winnerOffset = 0; winnerOffset < winners.length; ++winnerOffset) {
      const winner = winners[winnerOffset];
      const betPortion = pot.get(winner) ?? 0;
      for (const [p, betAmount] of Array.from(pot.entries())) {
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
      amountsToBeUpdated.set(winner, (amountsToBeUpdated.get(winner) ?? 0) + wonPortion);
    }
  }
  for (const [p, remaining] of Array.from(pot.entries())) {
    amountsToBeUpdated.set(p, (amountsToBeUpdated.get(p) ?? 0) + remaining);
  }
  for (const [p, amount] of Array.from(amountsToBeUpdated)) {
    if (amount === 0) amountsToBeUpdated.delete(p);
  }
  return amountsToBeUpdated;
}

function applyNewRound(state: ReducedTableState, event: ReducerEvent): void {
  if (typeof event.round !== 'number' || !event.players || !event.settings) {
    return;
  }
  // E-2 idempotency: a round number that already exists is never re-created. A duplicate or
  // forged `newRound` for a live (or past) round must not overwrite its state — that is how a
  // replayed/forged reset would vaporize the committed pot and destroy chips.
  if (state.rounds.has(event.round)) {
    return;
  }
  // E-2 no mid-hand reset: a fresh deal only begins once the previous hand has resolved. A
  // `newRound` arriving while the current hand is still unresolved (chips committed, no result)
  // is a forged "restart" whose only effect would be to abandon the live pot — ignore it.
  // (The first hand has no current round and is unaffected; a normal next-hand deal arrives
  // only after the prior round resolved, so legitimate play is untouched.)
  if (state.handInProgress && state.currentRound !== null) {
    const current = state.rounds.get(state.currentRound);
    if (current && !current.result) {
      return;
    }
  }
  // E-2 seat-list integrity: deal each distinct peer at most once (a forged duplicate-self seat
  // list let one identity hold two seats and skim between them); the relay system id is never a
  // seat; a real hand needs >= 2 distinct players.
  const seen = new Set<string>();
  const players: string[] = [];
  for (const p of event.players) {
    if (typeof p !== 'string' || p === RELAY_SYSTEM_SENDER || seen.has(p)) continue;
    seen.add(p);
    players.push(p);
  }
  if (players.length < 2) {
    return;
  }
  const settings = normalizeRoundSettings(event.settings, event.round);
  const bigBlind = settings.bigBlindAmount!;
  const smallBlind = settings.smallBlindAmount!;

  // Auto-rebuy: top up any seated player below one big blind (mirrors the engine). Track
  // every chip bought in (initial seat + each rebuy) so session P&L = funds − boughtIn is a
  // balanced, deterministic figure — not an event-accumulated tally that drifts on replay.
  for (const player of players) {
    const fund = state.funds.get(player);
    if (!fund || fund < bigBlind) {
      state.funds.set(player, (fund ?? 0) + settings.initialFundAmount);
      state.boughtIn.set(player, (state.boughtIn.get(player) ?? 0) + settings.initialFundAmount);
    }
  }

  const round: ReducedRound = {
    round: event.round,
    players,
    settings,
    startFunds: new Map(state.funds),
    pot: new Map(),
    streetStartPot: new Map(),
    called: new Set(),
    folded: new Set(),
    allIn: new Set(),
    stage: ReducerStage.PRE_FLOP,
    currentTurn: null,
    callAmount: 0,
    showdownReady: false,
    voidApprovals: new Set(),
    cannotContinue: new Set(),
  };
  state.rounds.set(event.round, round);
  state.currentRound = event.round;
  state.handInProgress = true;

  // Seating bookkeeping: dealt-in players hold a seat and are not sitting out.
  for (const player of players) {
    state.sittingOut.delete(player);
    state.seated.add(player);
    state.knownPeers.add(player);
  }

  // Post blinds synchronously (isBlind=true skips turn/called logic), then set the
  // first-to-act exactly like the engine.
  applyBet(state, round, smallBlind, players[0], true);
  applyBet(state, round, bigBlind, players[1], true);
  const firstToAct = players[2 % players.length];
  setTurn(state, round, firstToAct, players.length === 2 ? bigBlind - smallBlind : bigBlind);
  state.potAmount = potTotal(round.pot);
}

function setTurn(state: ReducedTableState, round: ReducedRound, who: string | null, callAmount: number): void {
  round.currentTurn = who;
  round.callAmount = who ? callAmount : 0;
  // Stamp WHEN this turn began on the trusted relay clock, so a later auto-fold can be checked
  // against the real elapsed time (D-1). A turn with no owner has no clock.
  round.currentTurnStartedAtRelayTs = who ? state._currentEventRelayTs : undefined;
}

function applyBet(
  state: ReducedTableState,
  round: ReducedRound,
  amount: number,
  who: string,
  isBlind: boolean,
): void {
  // No pause/turn re-gating beyond the turn owner: the log only ever contains events the
  // engine already accepted, so replaying it must apply every one (re-gating on a
  // different presence view is what would let a reconnecting client diverge).
  if (!Number.isSafeInteger(amount) || amount < 0) return;
  const fund = state.funds.get(who) ?? 0;
  if (fund < amount) return;
  if (round.result) return;
  if (!isBlind && round.currentTurn !== who) return;

  const currentBet = round.pot.get(who) ?? 0;
  const leastTotal = maxBet(round.pot);
  const totalBet = currentBet + amount;
  const allin = fund === amount;
  if (totalBet < leastTotal && !allin) return;

  if (!isBlind) {
    if (totalBet === leastTotal) {
      round.called.add(who);
    } else {
      round.called.clear();
      round.called.add(who);
    }
  }
  if (allin) round.allIn.add(who);

  round.pot.set(who, totalBet);
  state.funds.set(who, fund - amount);
  state.potAmount = potTotal(round.pot);

  if (!isBlind) {
    if (round.currentTurn === who) {
      round.currentTurn = null;
    }
    continueUnlessAllSet(state, round, who);
  }
}

function applyFold(
  state: ReducedTableState,
  round: ReducedRound,
  who: string,
): void {
  if (round.result) return;
  if (round.folded.has(who)) return;
  if (round.currentTurn === who) {
    round.currentTurn = null;
  }
  round.folded.add(who);

  const playersLeft = round.players.filter(p => !round.folded.has(p));
  if (playersLeft.length === 1) {
    const winner = playersLeft[0];
    round.result = { how: 'LastOneWins', round: round.round, winner };
    state.resolvedRounds.push(round.round);
    state.handInProgress = false;
    round.currentTurn = null;
    const total = potTotal(round.pot);
    state.funds.set(winner, (state.funds.get(winner) ?? 0) + total);
  } else {
    continueUnlessAllSet(state, round, who);
  }
}

// Mirrors continueUnlessAllSet: advance to the next actor, or close the street /
// trigger the all-in run-out / mark showdown-ready. Showdown resolution itself happens
// in resolvePendingShowdowns once the needed cards are revealed.
function continueUnlessAllSet(
  state: ReducedTableState,
  round: ReducedRound,
  prevWho: string,
): void {
  const players = round.players;
  const prevOffset = players.findIndex(p => p === prevWho);
  const order = [...players.slice(prevOffset + 1), ...players.slice(0, prevOffset)];
  const next = order.find(
    p => !round.allIn.has(p) && !round.called.has(p) && !round.folded.has(p),
  );

  if (!next) {
    const everyoneElseAllinOrFold = (players.length - round.allIn.size - round.folded.size) <= 1;
    round.called.clear();
    setTurn(state, round, null, 0);
    const shouldShowdown = everyoneElseAllinOrFold || round.stage === ReducerStage.RIVER;
    if (shouldShowdown) {
      round.showdownReady = true;
    }
    const nextVisibleBoardCount: 3 | 4 | 5 | null = (() => {
      switch (round.stage) {
        case ReducerStage.PRE_FLOP:
          return everyoneElseAllinOrFold ? 5 : 3;
        case ReducerStage.FLOP:
          return everyoneElseAllinOrFold ? 5 : 4;
        case ReducerStage.TURN:
          return 5;
        case ReducerStage.RIVER:
          return null;
      }
    })();
    if (nextVisibleBoardCount !== null) {
      round.stage = nextVisibleBoardCount === 3
        ? ReducerStage.FLOP
        : nextVisibleBoardCount === 4
          ? ReducerStage.TURN
          : ReducerStage.RIVER;
      // A new betting street begins: snapshot the cumulative pot so per-street bet chips
      // (cumulative - streetStart) reset to 0 for everyone, matching the table UX.
      round.streetStartPot = new Map(round.pot);
    }
    if (!everyoneElseAllinOrFold && !shouldShowdown) {
      const next2 = players.find(p => !round.allIn.has(p) && !round.folded.has(p)) || null;
      setTurn(state, round, next2, 0);
    }
  } else {
    const currentBet = round.pot.get(next) ?? 0;
    const callAmount = maxBet(round.pot) - currentBet;
    setTurn(state, round, next, callAmount);
  }
}

// Resolve any showdown-ready round whose required cards are now all revealed. Pure: it
// reads `reveals` and produces the result + awards exactly like tryResolveShowdown.
function resolvePendingShowdowns(state: ReducedTableState, reveals: CardReveals): void {
  for (const round of Array.from(state.rounds.values())) {
    if (!round.showdownReady || round.result) continue;
    const eligible = round.players
      .map((player, playerOffset) => ({ player, playerOffset }))
      .filter(({ player }) => !round.folded.has(player));
    if (eligible.length < 2) continue;

    const cards = reveals.get(round.round);
    if (!cards) continue;
    const requiredOffsets = [
      0, 1, 2, 3, 4,
      ...eligible.flatMap(({ playerOffset }) => [playerOffset * 2 + 5, playerOffset * 2 + 6]),
    ];
    if (!requiredOffsets.every(offset => cards.has(offset))) continue;

    const board = [0, 1, 2, 3, 4].map(offset => cards.get(offset)!);
    const strengthOfPlayers = eligible.map(({ player, playerOffset }) => {
      const hole = [cards.get(playerOffset * 2 + 5)!, cards.get(playerOffset * 2 + 6)!];
      const strength = evaluateStandardCards([...hole, ...board]);
      return { player, handValue: handRank(strength), strength };
    });

    const showdown: ShowdownResult['showdown'] = [];
    for (const s of strengthOfPlayers.slice().sort((a, b) => a.strength - b.strength)) {
      const last = showdown.length > 0 ? showdown[showdown.length - 1] : null;
      if (last && last.strength === s.strength) {
        last.players.push(s.player);
      } else {
        showdown.push({ players: [s.player], handValue: s.handValue, strength: s.strength });
      }
    }

    round.result = { how: 'Showdown', round: round.round, showdown };
    state.resolvedRounds.push(round.round);
    if (state.currentRound === round.round) {
      state.handInProgress = false;
    }
    const awards = calculateAwards(round.pot, showdown);
    for (const [winner, award] of Array.from(awards.entries())) {
      state.funds.set(winner, (state.funds.get(winner) ?? 0) + award);
    }
  }
}

// Refund every committed chip and mark the round VOIDED (mirrors the engine's voidHand).
function refundVoid(
  state: ReducedTableState,
  round: ReducedRound,
  approvals: string[],
  missing: string[],
): void {
  if (round.result) return;
  for (const [player, committed] of Array.from(round.pot.entries())) {
    if (committed > 0) state.funds.set(player, (state.funds.get(player) ?? 0) + committed);
  }
  round.currentTurn = null;
  round.result = { how: 'Voided', round: round.round, missingPlayers: missing.slice(), approvals: approvals.slice() };
  if (!state.resolvedRounds.includes(round.round)) state.resolvedRounds.push(round.round);
  if (state.currentRound === round.round) state.handInProgress = false;
  state.potAmount = potTotal(round.pot);
}

// E-1: derive a void+refund ONLY from the same signed evidence the engine requires — never
// from a bare `hand/result` (which any player could forge to dodge a losing hand). A void is
// legitimate when the hand is GENUINELY unfinishable: a participant is unreachable AND the
// table either unanimously voted to void (every still-present dealt-in player approved) or a
// dealt-in player declared cannotContinue. A fully-connected cannotContinue is NOT a void —
// it is treated as that player folding (the engine's anti-dodge), so chips can never be
// clawed back by a connected player abandoning a hand. `connected` is the live reachable set
// (the same mesh view the engine uses), so this stays consistent with the engine's decision.
function resolvePendingVoids(state: ReducedTableState, connected: Set<string>): void {
  for (const round of Array.from(state.rounds.values())) {
    if (round.result) continue;
    if (round.voidApprovals.size === 0 && round.cannotContinue.size === 0) continue;
    const dealtIn = round.players;
    const missing = dealtIn.filter(p => !connected.has(p));
    if (round.cannotContinue.size > 0) {
      if (missing.length > 0) {
        refundVoid(state, round, dealtIn.filter(p => !missing.includes(p)), missing);
      } else {
        // Fully connected "I can't continue" = anti-dodge: the declarer simply folds.
        for (const declarer of Array.from(round.cannotContinue)) {
          if (round.result) break;
          if (dealtIn.includes(declarer) && !round.folded.has(declarer)) {
            applyFold(state, round, declarer);
          }
        }
      }
      continue;
    }
    // Unanimous manual void vote: only on a paused hand (someone unreachable) and only when
    // every still-present dealt-in player has signed an approving vote.
    if (missing.length > 0) {
      const present = dealtIn.filter(p => connected.has(p));
      if (present.length > 0 && present.every(p => round.voidApprovals.has(p))) {
        refundVoid(state, round, present, missing);
      }
    }
  }
}

function applyEvent(state: ReducedTableState, event: ReducerEvent): void {
  state._currentEventRelayTs = event.relayTs;
  switch (event.type) {
    case 'newRound':
      applyNewRound(state, event);
      return;
    case 'action/bet': {
      if (typeof event.round !== 'number' || event.from === undefined || event.amount === undefined) return;
      note(state, event.from);
      const round = state.rounds.get(event.round);
      if (!round) return;
      applyBet(state, round, event.amount, event.from, false);
      return;
    }
    case 'action/fold': {
      if (typeof event.round !== 'number' || event.from === undefined) return;
      note(state, event.from);
      const round = state.rounds.get(event.round);
      if (!round) return;
      applyFold(state, round, event.from);
      return;
    }
    case 'action/autoFold': {
      // A thinking-timeout folds the current hand but the player KEEPS their seat
      // (matches the live engine/worker), so seating is untouched here.
      if (typeof event.round !== 'number' || !event.target) return;
      note(state, event.target);
      const round = state.rounds.get(event.round);
      if (!round) return;
      // D-1: only the player whose turn it actually is may be auto-folded for a timeout —
      // exactly the engine's canAutoFold guard. A target that is not the active turn is a
      // forgery, so drop it.
      if (round.currentTurn !== event.target) return;
      // R4·01 — AUTHORIZATION, not relay-clock timing. The previous closure trusted the relay's
      // receive-timestamp to prove a timeout elapsed, but that clock is operator-controlled and
      // unsigned (not in the hash-chain), so a relay colluding with a seat could inflate it to
      // fold a present, on-turn opponent and take the pot — power beyond "controlling connections".
      // A timeout is now self-authorized: a player is auto-folded only when THEIR OWN client emits
      // it (from === target, a self-fold on the emitter's own local clock — needs no shared clock),
      // OR when the target is genuinely unreachable in the live set (a dropped player must not
      // freeze the table — the existing disconnect behavior). Folding a PRESENT opponent on someone
      // else's word is refused outright, so no forged relay timestamp can move the pot.
      const selfFold = event.from !== undefined && event.from === event.target;
      const targetUnreachable = !(state._connected?.has(event.target) ?? false);
      if (!selfFold && !targetUnreachable) return;
      applyFold(state, round, event.target);
      return;
    }
    case 'action/sitOut': {
      if (event.from === undefined) return;
      state.sittingOut.add(event.from);
      state.seated.delete(event.from);
      note(state, event.from);
      if (typeof event.round === 'number') {
        const round = state.rounds.get(event.round);
        if (round && !round.result && round.players.includes(event.from)) {
          applyFold(state, round, event.from);
        }
      }
      return;
    }
    case 'action/returnToTable':
      if (event.from !== undefined) {
        state.sittingOut.delete(event.from);
        state.seated.add(event.from);
        note(state, event.from);
      }
      return;
    case 'action/takeSeat': {
      // Purely positional: record the sender's chosen seat (where they are DRAWN around the
      // oval). Real-poker seat discipline, enforced deterministically from the log so every
      // client agrees:
      //   1. NO seat change while a hand is live — a takeSeat that lands mid-hand in the log
      //      is ignored outright (not queued), so the table never reshuffles mid-deal.
      //   2. You take the EXACT seat you clicked, or nothing — never a different one.
      //   3. You cannot take a seat another PRESENT player already holds (first chooser keeps
      //      it). A departed peer's stale reservation does not block the seat.
      if (event.from === undefined || typeof event.seat !== 'number') return;
      if (state.handInProgress) return; // (1) locked during a live hand
      const seat = Math.floor(event.seat);
      if (seat < 0 || seat >= SEAT_COUNT) return; // (2) only a real seat
      note(state, event.from);
      const heldByPresentOther = Array.from(state.seatChoices.entries()).some(
        ([peer, s]) =>
          peer !== event.from && s === seat && (state._connected?.has(peer) ?? true),
      ); // (3)
      if (heldByPresentOther) return;
      state.seatChoices.set(event.from, seat);
      return;
    }
    case 'action/openRegistration':
      state.currentRound = null;
      state.handInProgress = false;
      state.sittingOut.clear();
      state.seated.clear();
      return;
    case 'action/voidHandVote': {
      // Record a signed approving void vote from a dealt-in player. The void itself is decided
      // in resolvePendingVoids (unanimous among still-present players on a paused hand). (E-1)
      if (typeof event.round !== 'number' || event.from === undefined || event.approve !== true) return;
      note(state, event.from);
      const round = state.rounds.get(event.round);
      if (!round || round.result) return;
      if (round.players.includes(event.from)) round.voidApprovals.add(event.from);
      return;
    }
    case 'action/cannotContinue': {
      // Record a signed "this hand can't be finished" declaration from a dealt-in player. The
      // outcome (objective void+refund vs. anti-dodge fold) is decided in resolvePendingVoids
      // from the live reachable set — never from a bare result. (E-1)
      if (typeof event.round !== 'number' || event.from === undefined) return;
      note(state, event.from);
      const round = state.rounds.get(event.round);
      if (!round || round.result) return;
      if (round.players.includes(event.from)) round.cannotContinue.add(event.from);
      return;
    }
    case 'hand/result': {
      // E-1: a `hand/result` is a bare, forgeable "hand over" signal — exactly what the live
      // engine treats as informational and ignores. It must NEVER move funds: the old reducer
      // refunded the pot on any unresolved-hand result, letting any player dodge a losing hand
      // (and claw their chips back) with one console command. Real voids are derived from the
      // signed voidHandVote / cannotContinue evidence in resolvePendingVoids instead, so this
      // is now a no-op; the resolution paths already manage handInProgress.
      return;
    }
  }
}

const REDUCER_EVENT_TYPES = new Set<ReducerEvent['type']>([
  'newRound', 'action/bet', 'action/fold', 'action/autoFold',
  'action/sitOut', 'action/returnToTable', 'action/openRegistration',
  'action/voidHandVote', 'action/cannotContinue', 'action/takeSeat', 'hand/result',
]);

// Map the recorded transcript (the ordered signed log the relay sequences) into the
// reducer's event list. The signed sender is the actor; private mental-poker key events
// and any non-table payloads are skipped. This is what lets the live client derive its
// canonical state from exactly the same log every other client (and the verifier) sees.
export function transcriptToReducerEvents(
  transcript: TranscriptSnapshot<TexasHoldemTableEvent>,
): ReducerEvent[] {
  const events: ReducerEvent[] = [];
  for (const entry of transcript.entries) {
    if (entry.scope !== 'public') continue;
    if (entry.signed && entry.signatureValid === false) continue; // the engine rejects these too
    const relayTs = typeof entry.relayTs === 'number' ? entry.relayTs : undefined;
    const wire = entry.wireEvent;
    const payload = (isSignedGameEvent<TexasHoldemTableEvent>(wire) ? wire.payload : wire) as any;
    const from = (isSignedGameEvent<TexasHoldemTableEvent>(wire) ? wire.sender : entry.transportSender);
    if (!payload || typeof payload.type !== 'string' || !REDUCER_EVENT_TYPES.has(payload.type)) continue;
    events.push({
      type: payload.type,
      from,
      round: payload.round,
      amount: payload.amount,
      target: payload.target,
      players: payload.players,
      settings: payload.settings,
      approve: payload.approve,
      seat: payload.seat,
      relayTs,
    });
  }
  return events;
}

// Convenience for the live client: the connected set the betting reducer needs to avoid
// spuriously "pausing" an already-accepted log is simply everyone who appears in it
// (the log only contains actions the engine already accepted).
export function connectedPeersFromEvents(events: ReducerEvent[]): Set<string> {
  const connected = new Set<string>();
  for (const e of events) {
    if (e.from && e.from !== RELAY_SYSTEM_SENDER) connected.add(e.from);
    for (const p of e.players ?? []) if (p !== RELAY_SYSTEM_SENDER) connected.add(p);
  }
  return connected;
}

// Per-seat bet-chip view for the CURRENT street, derived purely from the reduced round.
// Matches the engine's `actionsDone` semantics — current-street committed amount, or
// 'fold' / 'all-in' / 'check' — but is a deterministic function of the log, so the chips
// converge across clients (no more "bets vanish" on one side). (REWORK_PLAN S2-rest.)
export function reducedActionsByPlayer(round: ReducedRound): Map<string, number | string> {
  const map = new Map<string, number | string>();
  for (const player of round.players) {
    if (round.folded.has(player)) {
      map.set(player, 'fold');
      continue;
    }
    if (round.allIn.has(player)) {
      map.set(player, 'all-in');
      continue;
    }
    const committed = (round.pot.get(player) ?? 0) - (round.streetStartPot.get(player) ?? 0);
    if (committed > 0) {
      map.set(player, committed);
    } else if (round.called.has(player)) {
      map.set(player, 'check');
    }
  }
  return map;
}

// A durable funds snapshot taken between hands ("after round `throughRound` resolved").
// Persisted locally so a refreshing/reopening client re-derives correct bankrolls even
// though the relay only replays the CURRENT hand's events (it cannot give back the full
// history). Seeding the reducer with this checkpoint and skipping events for rounds already
// covered by it makes funds survive a refresh AND bakes in past showdown results — so the
// reducer needs no past card reveals (only the live hand's). See useTexasHoldem.
export interface FundsCheckpoint {
  throughRound: number; // funds/boughtIn are as of the moment this round had fully resolved
  funds: Map<string, number>;
  boughtIn: Map<string, number>;
}

/**
 * Fold the ordered table-event log + card reveals + the currently-reachable peer set
 * into the canonical table state. Pure and deterministic. An optional funds checkpoint
 * seeds bankrolls and causes events for already-checkpointed rounds to be skipped (applied
 * exactly once, on top of the checkpoint) — the durability mechanism for refresh/reopen.
 */
export function reduceTexasHoldem(
  events: ReducerEvent[],
  reveals: CardReveals = new Map(),
  connected: Iterable<string> = [],
  checkpoint?: FundsCheckpoint,
): ReducedTableState {
  const state = emptyState();
  const through = checkpoint && Number.isInteger(checkpoint.throughRound) ? checkpoint.throughRound : 0;
  if (checkpoint) {
    for (const [peer, amount] of Array.from(checkpoint.funds)) state.funds.set(peer, amount);
    for (const [peer, amount] of Array.from(checkpoint.boughtIn)) state.boughtIn.set(peer, amount);
    for (const peer of Array.from(checkpoint.funds.keys())) state.knownPeers.add(peer);
  }
  const connectedSet = new Set(Array.from(connected).filter(p => p !== RELAY_SYSTEM_SENDER));
  state._connected = connectedSet; // expose to applyEvent for auto-fold authorization (R4·01)
  for (const peer of Array.from(connectedSet)) state.knownPeers.add(peer);
  for (const event of events) {
    // Events for rounds already folded into the checkpoint are skipped, so each round is
    // applied exactly once regardless of how much the relay replays. Round-less events
    // (e.g. updateSettings) always apply.
    if (typeof event.round === 'number' && event.round <= through) continue;
    applyEvent(state, event);
    // Card reveals can complete a showdown the instant its cards are known; re-checking
    // after every event keeps resolution deterministic regardless of reveal timing.
    resolvePendingShowdowns(state, reveals);
    // A void becomes legitimate once its signed evidence + the reachable set line up (E-1).
    resolvePendingVoids(state, connectedSet);
  }
  resolvePendingShowdowns(state, reveals);
  resolvePendingVoids(state, connectedSet);
  if (state.currentRound !== null) {
    state.potAmount = potTotal(state.rounds.get(state.currentRound)?.pot ?? new Map());
  }
  computeSeating(state, connectedSet);
  return state;
}

// Derive the seating/lifecycle view (the browser-authoritative replacement for the
// Worker's roomState) from the accumulated seats + the locally-reachable peer set.
// Mirrors the live worker/engine semantics: between hands every reachable, non-sitting-out
// peer is seatable; during a hand a dealt-in player who is currently unreachable is
// 'missing' (transient — they rejoin the instant they are reachable, no sticky lock-out);
// an auto-folded player keeps their seat.
function computeSeating(state: ReducedTableState, connected: Set<string>): void {
  const currentRoundData = state.currentRound !== null ? state.rounds.get(state.currentRound) : undefined;
  const currentPlayers = state.handInProgress && currentRoundData ? currentRoundData.players : [];
  const foldedNow = currentRoundData ? currentRoundData.folded : new Set<string>();

  // Between hands (or before any hand): everyone reachable who has not opted out is
  // seatable for the next hand.
  if (!state.handInProgress) {
    for (const peer of Array.from(connected)) {
      if (!state.sittingOut.has(peer)) state.seated.add(peer);
    }
  }

  const missing = new Set<string>();
  if (state.handInProgress) {
    for (const peer of currentPlayers) {
      if (!connected.has(peer) && !foldedNow.has(peer)) missing.add(peer);
    }
  }

  // Cap the table at MAX_SEATS. Players already dealt into the live hand always keep
  // their seat; between hands the seatable set is taken in a deterministic order (sorted
  // peerId — identical on every client) and trimmed to MAX_SEATS, so the same 9 are
  // seated everywhere and any extras fall back to spectating ('watching').
  const sortedPeers = Array.from(state.knownPeers).sort();
  const seatableInOrder = sortedPeers.filter(peerId =>
    state.seated.has(peerId) && connected.has(peerId) && !state.sittingOut.has(peerId));
  const dealtIn = new Set(currentPlayers);
  const seatAllowed = new Set<string>(dealtIn);
  for (const peerId of seatableInOrder) {
    if (seatAllowed.size >= MAX_SEATS) break;
    seatAllowed.add(peerId);
  }

  const seatPlayers: SeatPlayer[] = sortedPeers.map(peerId => {
    const online = connected.has(peerId);
    const isMissing = missing.has(peerId);
    const seated = state.seated.has(peerId) && online && !state.sittingOut.has(peerId) && seatAllowed.has(peerId);
    const status: SeatStatus = !online
      ? (isMissing ? 'missing' : 'offline')
      : seated
        ? 'active'
        : state.sittingOut.has(peerId)
          ? 'sittingOut'
          : 'watching';
    return { peerId, online, seated, status };
  });

  state.seatPlayers = seatPlayers;
  state.seatedForNextHand = seatPlayers.filter(p => p.seated).map(p => p.peerId);
  state.missingPlayers = Array.from(missing).sort();
  state.playable = state.seatedForNextHand.length >= 2;

  // Resolve each at-the-table peer's absolute seat (positional only). Explicit choices
  // (action/takeSeat, already de-duped in the log) win; everyone else fills the lowest
  // free seat in peerId order, so every client derives the same arrangement.
  const seatByPeer = new Map<string, number>();
  const taken = new Set<number>();
  const atTable = Array.from(new Set<string>([...state.seatedForNextHand, ...currentPlayers])).sort();
  for (const peer of atTable) {
    const chosen = state.seatChoices.get(peer);
    if (chosen !== undefined && !taken.has(chosen)) {
      seatByPeer.set(peer, chosen);
      taken.add(chosen);
    }
  }
  // Everyone without an explicit choice gets a STABLE home seat derived from their peerId
  // (real-poker fixed seats): a player keeps the SAME chair no matter who else joins or
  // leaves, and a vacated chair stays empty — no cosmetic reshuffle that makes the whole
  // table appear to spin. Pure function of peerId + the seats already taken, so every
  // client (and the verifier) derives the identical arrangement. Processed in sorted
  // peerId order for a deterministic tie-break when two players hash to the same chair.
  const rest = atTable.filter(peer => !seatByPeer.has(peer));
  // During a live hand the players who were DEALT IN claim their home chair first, so a
  // spectator arriving mid-hand can never (even via a rare hash collision) bump a seated
  // player out of their chair — a dealt-in seat is locked for the whole hand.
  const restOrdered = [...rest.filter(p => dealtIn.has(p)), ...rest.filter(p => !dealtIn.has(p))];
  for (const peer of restOrdered) {
    const home = stableHomeSeat(peer, taken);
    if (home !== undefined) {
      seatByPeer.set(peer, home);
      taken.add(home);
    }
  }
  state.seatByPeer = seatByPeer;
}

// A deterministic "home seat" for a peer: hash the peerId to a starting chair, then probe
// forward to the next free chair. Depends only on the peerId and the already-taken set, so
// it is identical on every client and STABLE — a player's chair does not move when other
// players come or go (the only exception is a hash collision whose earlier holder leaves,
// which is rare and still deterministic).
function stableHomeSeat(peerId: string, taken: Set<number>): number | undefined {
  let h = 0;
  for (let i = 0; i < peerId.length; i++) h = (Math.imul(h, 31) + peerId.charCodeAt(i)) >>> 0;
  for (let probe = 0; probe < SEAT_COUNT; probe++) {
    const seat = (h + probe) % SEAT_COUNT;
    if (!taken.has(seat)) return seat;
  }
  return undefined; // table already full (atTable is capped at MAX_SEATS <= SEAT_COUNT)
}
