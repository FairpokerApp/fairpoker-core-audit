// GUARDIAN HARNESS — faithful model of the REAL failure mode (what single-engine sims missed).
//
// Models: one authoritative game (the engine) broadcasting signed events through a RELAY to
// TWO independent clients, each with its OWN transcript + localStorage. The relay mirrors the
// live worker: on (re)connect it can only replay the CURRENT hand's window (earlier events are
// compacted away). A "refresh" = a client throws away its in-memory transcript, keeps its
// localStorage (checkpoint + history), reconnects, and gets only the current-hand window.
//
// Acceptance the guardian drives to green:
//  (1) two never-closed clients always agree on funds (deterministic log);
//  (2) a refreshed client (current-hand window + its localStorage checkpoint) STILL agrees
//      with the never-closed client — the refresh/reopen/chip bug;
//  (3) funds are conserved and the P&L (funds−boughtIn) balances to zero at all times.

import { GameRoomEvents, GameEvent } from "../GameRoom";
import {
  GameRoomLike, MentalPokerGameRoomLike, TexasHoldemGameRoom, TexasHoldemTableEvent,
} from "./TexasHoldemGameRoom";
import Deferred from "../Deferred";
import EventEmitter from "eventemitter3";
import { MentalPokerGameRoomEvents, MentalPokerRoundSettings } from "../MentalPokerGameRoom";
import { getStandard52Deck, StandardCard } from "../secureMentalPoker";
import { reduceTexasHoldem, ReducerEvent, CardReveals, FundsCheckpoint } from "./texasHoldemReducer";

function rng(seed: number) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffledDeck(rand: () => number): StandardCard[] { const d = getStandard52Deck(); for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; } return d; }

// --- The authoritative game engine (generates a valid signed-equivalent event stream) ---
class Room implements GameRoomLike<TexasHoldemTableEvent> {
  peerIdAsync: Promise<string>; peerIdDeferred = new Deferred<string>();
  listener = new EventEmitter<GameRoomEvents<GameEvent<TexasHoldemTableEvent>>>();
  onEvent?: (sender: string, data: TexasHoldemTableEvent) => void;
  constructor(id: string) { this.peerIdAsync = this.peerIdDeferred.promise; this.peerIdDeferred.resolve(id); }
  async emitEvent(e: GameEvent<TexasHoldemTableEvent>) { this.dispatch(e.sender as string, e.data as TexasHoldemTableEvent); }
  dispatch(sender: string, data: TexasHoldemTableEvent) {
    this.listener.emit('event', { type: 'public', sender, data } as GameEvent<TexasHoldemTableEvent>, sender, false);
    this.onEvent?.(sender, data); // hand the event to the relay
  }
}
class Deck implements MentalPokerGameRoomLike {
  round = 0; listener = new EventEmitter<MentalPokerGameRoomEvents>(); members: string[] = []; peerId?: string;
  constructor(private decks: Map<number, StandardCard[]>, private reveals: CardReveals) {}
  hasIndividualKeysForRound() { return true; } wipeRoundSecrets() {}
  async startNewRound(_s: MentalPokerRoundSettings) { const r = ++this.round; setTimeout(() => this.listener.emit('shuffled'), 0); return r; }
  private emit(round: number, offset: number) {
    const d = this.decks.get(round);
    if (d && d[offset]) { let m = this.reveals.get(round); if (!m) { m = new Map(); this.reveals.set(round, m); } m.set(offset, d[offset]); this.listener.emit('card', round, offset, d[offset]); }
  }
  async showCard(round: number, offset: number) { this.emit(round, offset); }
  async dealCard(round: number, offset: number) { this.emit(round, offset); }
}

// --- Relay that mirrors the worker: sequences events, tracks handStartSeq, and on reconnect
//     can only return the CURRENT hand's window (earlier entries are compacted to nothing). ---
interface RelayEntry { seq: number; ev: ReducerEvent; }
class Relay {
  log: RelayEntry[] = [];
  nextSeq = 1;
  handStartSeq = 0;
  push(ev: ReducerEvent) {
    if (ev.type === 'newRound') this.handStartSeq = this.nextSeq;
    this.log.push({ seq: this.nextSeq++, ev });
  }
  // The live worker keeps full payloads only for entries >= handStartSeq; older ones are
  // compacted to placeholders the reducer drops. So a reconnect can reconstruct at most the
  // current hand.
  currentHandWindow(): ReducerEvent[] {
    return this.log.filter(e => e.seq >= this.handStartSeq).map(e => e.ev);
  }
  fullLog(): ReducerEvent[] { return this.log.map(e => e.ev); }
}

// --- A client: its own transcript (events it currently holds) + its own localStorage. ---
class ClientStore {
  checkpoint?: FundsCheckpoint;
  saveCheckpoint(reduced: ReturnType<typeof reduceTexasHoldem>) {
    if (!reduced.handInProgress && reduced.resolvedRounds.length) {
      const through = Math.max(...reduced.resolvedRounds);
      if (through > (this.checkpoint?.throughRound ?? 0)) {
        this.checkpoint = { throughRound: through, funds: new Map(reduced.funds), boughtIn: new Map(reduced.boughtIn) };
      }
    }
  }
}
function clientReduce(transcript: ReducerEvent[], reveals: CardReveals, store: ClientStore, members: string[]) {
  const hasGenesis = transcript.some(e => e.type === 'newRound' && e.round === 1);
  const checkpoint = !hasGenesis ? store.checkpoint : undefined;
  return reduceTexasHoldem(transcript, reveals, new Set(members), checkpoint);
}

const flush = () => new Promise<void>(r => setTimeout(r, 0));
const sorted = (m: Map<string, number>) => Array.from(m.entries()).sort();
const pnlSum = (r: ReturnType<typeof reduceTexasHoldem>) =>
  Array.from(r.funds.entries()).reduce((acc, [p, f]) => acc + (f - (r.boughtIn.get(p) ?? 0)), 0);

test('two clients agree on funds across repeated refreshes (relay replays only the current hand)', async () => {
  const rand = rng(0x6A11);
  const peerIds = ['A', 'B'];
  const decks = new Map<number, StandardCard[]>();
  const reveals: CardReveals = new Map();
  const gr = new Room('A');
  const mp = new Deck(decks, reveals); mp.peerId = 'A'; mp.members = [...peerIds];
  const engine = new TexasHoldemGameRoom(gr as any, mp as any);

  const relay = new Relay();
  // Two clients, each accumulating the broadcast stream into their own transcript + store.
  const A = { transcript: [] as ReducerEvent[], store: new ClientStore() };
  const B = { transcript: [] as ReducerEvent[], store: new ClientStore() };
  gr.onEvent = (sender, data) => {
    const d = data as any;
    const ev: ReducerEvent = { type: d.type, from: sender, round: d.round, amount: d.amount, target: d.target, players: d.players, settings: d.settings };
    relay.push(ev);
    A.transcript.push(ev);
    B.transcript.push(ev);
  };

  const refreshClient = (c: { transcript: ReducerEvent[]; store: ClientStore }) => {
    // Throw away in-memory transcript; keep localStorage (store). Reconnect → current-hand window.
    c.transcript = relay.currentHandWindow();
  };

  const HANDS = 10;
  for (let h = 0; h < HANDS; h++) {
    const round = h + 1;
    decks.set(round, shuffledDeck(rand));
    await engine.startNewRound({ initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2, participants: peerIds });
    await flush();
    for (let step = 0; step < 80; step++) {
      await flush();
      const snap = engine.getStateSnapshot();
      if (snap.winnersByRound.get(round)) break;
      const turn = snap.whoseTurnByRound.get(round);
      if (!turn || !turn.whoseTurn) { await flush(); continue; }
      const who = turn.whoseTurn;
      const fund = snap.bankrolls.get(who) ?? 0;
      const call = Math.max(0, turn.callAmount ?? 0);
      const r = rand();
      const amt = r < 0.3 && call > 0 ? -1 : r < 0.55 ? fund : Math.min(fund, call);
      if (amt < 0) { who === 'A' ? await engine.fold(round) : gr.dispatch(who, { type: 'action/fold', round } as TexasHoldemTableEvent); }
      else { who === 'A' ? await engine.bet(round, amt) : gr.dispatch(who, { type: 'action/bet', round, amount: amt } as TexasHoldemTableEvent); }
    }
    await flush(); await flush();

    // Both clients persist their between-hands checkpoint (like the live save effect).
    A.store.saveCheckpoint(clientReduce(A.transcript, reveals, A.store, peerIds));
    B.store.saveCheckpoint(clientReduce(B.transcript, reveals, B.store, peerIds));

    // Randomly refresh a client between hands and/or mid-stream next hand.
    if (rand() < 0.5) refreshClient(A);
    if (rand() < 0.4) refreshClient(B);

    // INVARIANTS after each hand:
    const truth = reduceTexasHoldem(relay.fullLog(), reveals, new Set(peerIds)).funds;
    const ra = clientReduce(A.transcript, reveals, A.store, peerIds);
    const rb = clientReduce(B.transcript, reveals, B.store, peerIds);
    // (1)+(2) both clients (refreshed or not) match the authoritative truth.
    expect({ who: 'A', funds: sorted(ra.funds) }).toEqual({ who: 'A', funds: sorted(truth) });
    expect({ who: 'B', funds: sorted(rb.funds) }).toEqual({ who: 'B', funds: sorted(truth) });
    // (3) P&L balances to zero on both.
    expect(pnlSum(ra)).toBe(0);
    expect(pnlSum(rb)).toBe(0);
    // funds never negative
    for (const v of Array.from(ra.funds.values())) expect(v).toBeGreaterThanOrEqual(0);
  }
  engine.close();
});

test('THREE players: refreshes during side-pot all-ins keep every client in agreement', async () => {
  const rand = rng(0x33C0);
  const peerIds = ['A', 'B', 'C'];
  const decks = new Map<number, StandardCard[]>();
  const reveals: CardReveals = new Map();
  const gr = new Room('A');
  const mp = new Deck(decks, reveals); mp.peerId = 'A'; mp.members = [...peerIds];
  const engine = new TexasHoldemGameRoom(gr as any, mp as any);
  const relay = new Relay();
  const clients = peerIds.map(() => ({ transcript: [] as ReducerEvent[], store: new ClientStore() }));
  gr.onEvent = (sender, data) => {
    const d = data as any;
    const ev: ReducerEvent = { type: d.type, from: sender, round: d.round, amount: d.amount, target: d.target, players: d.players, settings: d.settings };
    relay.push(ev);
    for (const c of clients) c.transcript.push(ev);
  };

  const HANDS = 10;
  for (let h = 0; h < HANDS; h++) {
    const round = h + 1;
    decks.set(round, shuffledDeck(rand));
    await engine.startNewRound({ initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2, participants: peerIds });
    await flush();
    for (let step = 0; step < 120; step++) {
      await flush();
      const snap = engine.getStateSnapshot();
      if (snap.winnersByRound.get(round)) break;
      const turn = snap.whoseTurnByRound.get(round);
      if (!turn || !turn.whoseTurn) { await flush(); continue; }
      const who = turn.whoseTurn;
      const fund = snap.bankrolls.get(who) ?? 0;
      const call = Math.max(0, turn.callAmount ?? 0);
      const r = rand();
      // Frequent all-ins of varying stacks → side pots.
      const amt = r < 0.25 && call > 0 ? -1 : r < 0.55 ? fund : Math.min(fund, call + Math.floor(rand() * 8));
      if (amt < 0) { who === 'A' ? await engine.fold(round) : gr.dispatch(who, { type: 'action/fold', round } as TexasHoldemTableEvent); }
      else { who === 'A' ? await engine.bet(round, amt) : gr.dispatch(who, { type: 'action/bet', round, amount: amt } as TexasHoldemTableEvent); }
    }
    await flush(); await flush();
    for (const c of clients) c.store.saveCheckpoint(clientReduce(c.transcript, reveals, c.store, peerIds));
    // Randomly refresh up to two clients each hand.
    for (const c of clients) if (rand() < 0.4) c.transcript = relay.currentHandWindow();

    const truth = reduceTexasHoldem(relay.fullLog(), reveals, new Set(peerIds)).funds;
    for (let i = 0; i < clients.length; i++) {
      const rc = clientReduce(clients[i].transcript, reveals, clients[i].store, peerIds);
      expect({ client: peerIds[i], funds: sorted(rc.funds) }).toEqual({ client: peerIds[i], funds: sorted(truth) });
      expect(pnlSum(rc)).toBe(0);
      for (const v of Array.from(rc.funds.values())) expect(v).toBeGreaterThanOrEqual(0);
    }
  }
  engine.close();
});

test('a sitting-out player keeps their chips, and a reconnecting window delivered IN PIECES stays consistent', async () => {
  const rand = rng(0x517C);
  const peerIds = ['A', 'B', 'C'];
  const decks = new Map<number, StandardCard[]>();
  const reveals: CardReveals = new Map();
  const gr = new Room('A');
  const mp = new Deck(decks, reveals); mp.peerId = 'A'; mp.members = [...peerIds];
  const engine = new TexasHoldemGameRoom(gr as any, mp as any);
  const relay = new Relay();
  const store = new ClientStore();
  let transcript: ReducerEvent[] = [];
  gr.onEvent = (sender, data) => {
    const d = data as any;
    const ev: ReducerEvent = { type: d.type, from: sender, round: d.round, amount: d.amount, target: d.target, players: d.players, settings: d.settings };
    relay.push(ev);
    transcript.push(ev);
  };
  const playOneHand = async (round: number) => {
    decks.set(round, shuffledDeck(rand));
    await engine.startNewRound({ initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2, participants: peerIds });
    await flush();
    for (let step = 0; step < 120; step++) {
      await flush();
      const snap = engine.getStateSnapshot();
      if (snap.winnersByRound.get(round)) break;
      const turn = snap.whoseTurnByRound.get(round);
      if (!turn || !turn.whoseTurn) { await flush(); continue; }
      const who = turn.whoseTurn;
      const fund = snap.bankrolls.get(who) ?? 0;
      const call = Math.max(0, turn.callAmount ?? 0);
      const r = rand();
      const amt = r < 0.3 && call > 0 ? -1 : r < 0.5 ? fund : Math.min(fund, call);
      if (amt < 0) { who === 'A' ? await engine.fold(round) : gr.dispatch(who, { type: 'action/fold', round } as TexasHoldemTableEvent); }
      else { who === 'A' ? await engine.bet(round, amt) : gr.dispatch(who, { type: 'action/bet', round, amount: amt } as TexasHoldemTableEvent); }
    }
    await flush(); await flush();
    store.saveCheckpoint(clientReduce(transcript, reveals, store, peerIds));
  };

  await playOneHand(1);
  await playOneHand(2);
  // C sits out between hands → the next hands are A/B only. C's chips must be untouched.
  const cFundsBefore = clientReduce(transcript, reveals, store, peerIds).funds.get('C') ?? 0;
  gr.dispatch('C', { type: 'action/sitOut' } as TexasHoldemTableEvent);
  await flush();
  await playOneHand(3);
  await playOneHand(4);
  const afterSitOut = clientReduce(transcript, reveals, store, peerIds);
  expect(afterSitOut.funds.get('C')).toBe(cFundsBefore); // sitting out costs nothing
  // Matches the authoritative engine for everyone.
  expect(sorted(afterSitOut.funds)).toEqual(sorted(reduceTexasHoldem(relay.fullLog(), reveals, new Set(peerIds)).funds));

  // C returns and plays again.
  gr.dispatch('C', { type: 'action/returnToTable' } as TexasHoldemTableEvent);
  await flush();
  await playOneHand(5);

  // RECONNECT, window delivered IN PIECES: a fresh client receives the current-hand window
  // one event at a time. At every prefix the funds must be conserved, and the final state
  // must equal the authoritative truth.
  const truth = reduceTexasHoldem(relay.fullLog(), reveals, new Set(peerIds)).funds;
  const window = relay.currentHandWindow();
  for (let k = 1; k <= window.length; k++) {
    const prefix = window.slice(0, k);
    const rc = clientReduce(prefix, reveals, store, peerIds);
    const rr = rc.currentRound != null ? rc.rounds.get(rc.currentRound) : undefined;
    const pot = rr && !rr.result ? Array.from(rr.pot.values()).reduce((a, b) => a + b, 0) : 0;
    const fundsT = Array.from(rc.funds.values()).reduce((a, b) => a + b, 0);
    const boughtT = Array.from(rc.boughtIn.values()).reduce((a, b) => a + b, 0);
    expect(fundsT + pot).toBe(boughtT); // conserved at every prefix
    for (const v of Array.from(rc.funds.values())) expect(v).toBeGreaterThanOrEqual(0);
  }
  expect(sorted(clientReduce(window, reveals, store, peerIds).funds)).toEqual(sorted(truth));
  engine.close();
});

test('a client that refreshes MID-hand still shows the correct live bankrolls', async () => {
  const rand = rng(0x9C0D);
  const peerIds = ['A', 'B'];
  const decks = new Map<number, StandardCard[]>();
  const reveals: CardReveals = new Map();
  const gr = new Room('A');
  const mp = new Deck(decks, reveals); mp.peerId = 'A'; mp.members = [...peerIds];
  const engine = new TexasHoldemGameRoom(gr as any, mp as any);
  const relay = new Relay();
  const store = new ClientStore();
  let transcript: ReducerEvent[] = [];
  gr.onEvent = (sender, data) => {
    const d = data as any;
    const ev: ReducerEvent = { type: d.type, from: sender, round: d.round, amount: d.amount, target: d.target, players: d.players, settings: d.settings };
    relay.push(ev);
    transcript.push(ev);
  };

  const HANDS = 8;
  for (let h = 0; h < HANDS; h++) {
    const round = h + 1;
    decks.set(round, shuffledDeck(rand));
    await engine.startNewRound({ initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2, participants: peerIds });
    await flush();
    for (let step = 0; step < 80; step++) {
      await flush();
      const snap = engine.getStateSnapshot();
      if (snap.winnersByRound.get(round)) break;
      const turn = snap.whoseTurnByRound.get(round);
      if (!turn || !turn.whoseTurn) { await flush(); continue; }
      const who = turn.whoseTurn;
      const fund = snap.bankrolls.get(who) ?? 0;
      const call = Math.max(0, turn.callAmount ?? 0);
      const r = rand();
      const amt = r < 0.3 && call > 0 ? -1 : r < 0.55 ? fund : Math.min(fund, call);
      if (amt < 0) { who === 'A' ? await engine.fold(round) : gr.dispatch(who, { type: 'action/fold', round } as TexasHoldemTableEvent); }
      else { who === 'A' ? await engine.bet(round, amt) : gr.dispatch(who, { type: 'action/bet', round, amount: amt } as TexasHoldemTableEvent); }
      await flush();

      // REFRESH MID-HAND at a random live step: drop transcript, keep store, get current window.
      if (rand() < 0.25) {
        transcript = relay.currentHandWindow();
        const reducedAfterRefresh = clientReduce(transcript, reveals, store, peerIds);
        // The refreshed client's live bankrolls must equal the authoritative engine's funds.
        const engineFunds = engine.getStateSnapshot().bankrolls;
        expect(sorted(reducedAfterRefresh.funds)).toEqual(sorted(engineFunds));
        // Conservation: funds + chips-in-pot == total bought in (P&L only nets to 0 between
        // hands; mid-hand the difference is exactly what is sitting in the pot). A RESOLVED
        // round's pot is already awarded back into funds (round.pot is left stale by design),
        // so it counts as 0.
        const rr = reducedAfterRefresh.currentRound != null ? reducedAfterRefresh.rounds.get(reducedAfterRefresh.currentRound) : undefined;
        const potNow = rr && !rr.result ? Array.from(rr.pot.values()).reduce((a, b) => a + b, 0) : 0;
        const fundsNow = Array.from(reducedAfterRefresh.funds.values()).reduce((a, b) => a + b, 0);
        const boughtInNow = Array.from(reducedAfterRefresh.boughtIn.values()).reduce((a, b) => a + b, 0);
        expect(fundsNow + potNow).toBe(boughtInNow);
      }
    }
    await flush(); await flush();
    store.saveCheckpoint(clientReduce(transcript, reveals, store, peerIds));
  }
  engine.close();
});
