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
  showdownReady: boolean;
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
  missingPlayers: string[]; // current-hand players unreachable right now
  playable: boolean; // >= 2 seated players ⇒ a hand can start/continue
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
    | 'hand/result';
  from?: string; // signed sender
  round?: number | null;
  amount?: number;
  target?: string; // autoFold target
  players?: string[]; // newRound seat order
  settings?: TexasHoldemRoundSettings; // newRound settings
}

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
  const settings = normalizeRoundSettings(event.settings, event.round);
  const players = event.players.slice();
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
  setTurn(round, firstToAct, players.length === 2 ? bigBlind - smallBlind : bigBlind);
  state.potAmount = potTotal(round.pot);
}

function setTurn(round: ReducedRound, who: string | null, callAmount: number): void {
  round.currentTurn = who;
  round.callAmount = who ? callAmount : 0;
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
    setTurn(round, null, 0);
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
      setTurn(round, next2, 0);
    }
  } else {
    const currentBet = round.pot.get(next) ?? 0;
    const callAmount = maxBet(round.pot) - currentBet;
    setTurn(round, next, callAmount);
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

function applyEvent(state: ReducedTableState, event: ReducerEvent): void {
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
    case 'action/openRegistration':
      state.currentRound = null;
      state.handInProgress = false;
      state.sittingOut.clear();
      state.seated.clear();
      return;
    case 'hand/result': {
      if (typeof event.round === 'number') {
        const round = state.rounds.get(event.round);
        // A hand/result for a round the reducer has NOT resolved by showdown/fold means the
        // hand ended without a normal outcome — it was VOIDED (e.g. a disconnect mid-betting
        // or a unanimous void & refund). The committed chips must be returned, exactly as the
        // engine's voidHand does; otherwise funds drift LOW after any void (and that wrong
        // value would then be checkpointed). Only an interrupted hand is refunded (no result
        // AND betting not complete), so a showdown still awaiting its reveals is never
        // mistaken for a void and double-paid.
        if (round && !round.result && !round.showdownReady) {
          for (const [player, committed] of Array.from(round.pot.entries())) {
            if (committed > 0) state.funds.set(player, (state.funds.get(player) ?? 0) + committed);
          }
          round.result = { how: 'Voided', round: round.round, missingPlayers: [], approvals: [] };
          if (!state.resolvedRounds.includes(round.round)) state.resolvedRounds.push(round.round);
        }
        if (event.round === state.currentRound) {
          state.handInProgress = false;
        }
      }
      return;
    }
  }
}

const REDUCER_EVENT_TYPES = new Set<ReducerEvent['type']>([
  'newRound', 'action/bet', 'action/fold', 'action/autoFold',
  'action/sitOut', 'action/returnToTable', 'action/openRegistration', 'hand/result',
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
  }
  resolvePendingShowdowns(state, reveals);
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

  const seatPlayers: SeatPlayer[] = Array.from(state.knownPeers).sort().map(peerId => {
    const online = connected.has(peerId);
    const isMissing = missing.has(peerId);
    const seated = state.seated.has(peerId) && online && !state.sittingOut.has(peerId);
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
}
