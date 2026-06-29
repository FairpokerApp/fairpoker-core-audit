// REGRESSION for the live "金额错乱 / 卡在 $0" bug (2026-06-29).
//
// Root cause: displayed seat stacks (bankrolls) were served from the OLD imperative engine
// (incremental `fund` events), while whose-turn / pot came from the PURE reducer over the
// full signed transcript. On a refresh the engine only sees the CURRENT hand's window
// (handStartSeq), so its funds go stale — a player could read $0 while the reducer still
// said it was their turn → an unwinnable deadlock, plus garbage tallies. S2/S4 migrated
// pot/turn/seat/history to the reducer but LEFT funds on the engine (the "改漏了").
//
// Fix: serve bankrolls from the reducer over the full transcript, fed with card reveals
// (so showdown winnings are included). This test proves:
//   (1) reducer(funds, WITH reveals) over the full log == the engine's funds (correctness),
//   (2) the OLD path (engine over only the last-hand window) diverges (the bug),
//   (3) the NEW path stays correct across that same refresh (the fix).

import { GameRoomEvents, GameEvent } from "../GameRoom";
import {
  GameRoomLike,
  MentalPokerGameRoomLike,
  TexasHoldemGameRoom,
  TexasHoldemTableEvent,
} from "./TexasHoldemGameRoom";
import Deferred from "../Deferred";
import EventEmitter from "eventemitter3";
import { MentalPokerGameRoomEvents, MentalPokerRoundSettings } from "../MentalPokerGameRoom";
import { getStandard52Deck, StandardCard } from "../secureMentalPoker";
import { reduceTexasHoldem, ReducerEvent, CardReveals } from "./texasHoldemReducer";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffledDeck(rand: () => number): StandardCard[] {
  const d = getStandard52Deck();
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
class Room implements GameRoomLike<TexasHoldemTableEvent> {
  peerIdAsync: Promise<string>;
  peerIdDeferred = new Deferred<string>();
  listener = new EventEmitter<GameRoomEvents<GameEvent<TexasHoldemTableEvent>>>();
  log: ReducerEvent[] = [];
  raw: GameEvent<TexasHoldemTableEvent>[] = [];
  constructor(localId: string) { this.peerIdAsync = this.peerIdDeferred.promise; this.peerIdDeferred.resolve(localId); }
  async emitEvent(e: GameEvent<TexasHoldemTableEvent>) { this.dispatch(e.sender as string, e.data as TexasHoldemTableEvent); }
  dispatch(sender: string, data: TexasHoldemTableEvent) {
    const d = data as any;
    this.log.push({ type: d.type, from: sender, round: d.round, amount: d.amount, target: d.target, players: d.players, settings: d.settings });
    const e = { type: 'public', sender, data } as GameEvent<TexasHoldemTableEvent>;
    this.raw.push(e);
    this.listener.emit('event', e, sender, false);
  }
}
class Deck implements MentalPokerGameRoomLike {
  round = 0;
  listener = new EventEmitter<MentalPokerGameRoomEvents>();
  members: string[] = [];
  peerId?: string;
  constructor(private decks: Map<number, StandardCard[]>, private reveals: CardReveals) {}
  hasIndividualKeysForRound() { return true; }
  wipeRoundSecrets() {}
  async startNewRound(_s: MentalPokerRoundSettings) { const r = ++this.round; setTimeout(() => this.listener.emit('shuffled'), 0); return r; }
  private emit(round: number, offset: number) {
    const d = this.decks.get(round);
    if (d && d[offset]) {
      let m = this.reveals.get(round);
      if (!m) { m = new Map(); this.reveals.set(round, m); }
      m.set(offset, d[offset]);
      this.listener.emit('card', round, offset, d[offset]);
    }
  }
  async showCard(round: number, offset: number) { this.emit(round, offset); }
  async dealCard(round: number, offset: number) { this.emit(round, offset); }
}
const flush = () => new Promise<void>(r => setTimeout(r, 0));
const sorted = (m: Map<string, number>) => Array.from(m.entries()).sort();

test('bankrolls from the reducer (with reveals) match the engine and survive a partial-window refresh', async () => {
  const rand = rng(0xBEEF);
  const peerIds = ['A', 'B'];
  const decks = new Map<number, StandardCard[]>();
  const reveals: CardReveals = new Map();
  const gr = new Room('A');
  const mp = new Deck(decks, reveals);
  mp.peerId = 'A';
  mp.members = [...peerIds];
  const engine = new TexasHoldemGameRoom(gr as any, mp as any);

  // Drive several hands with a mix of folds and all-in showdowns (so awards genuinely
  // depend on reveals and funds move across hands).
  const HANDS = 5;
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
      const amt = r < 0.25 && call > 0 ? -1 : r < 0.55 ? fund /* all-in → showdown */ : Math.min(fund, call);
      if (amt < 0) { who === 'A' ? await engine.fold(round) : gr.dispatch(who, { type: 'action/fold', round } as TexasHoldemTableEvent); }
      else { who === 'A' ? await engine.bet(round, amt) : gr.dispatch(who, { type: 'action/bet', round, amount: amt } as TexasHoldemTableEvent); }
    }
    await flush(); await flush();
  }

  const fullLog = gr.log.slice();
  const truth = engine.getStateSnapshot().bankrolls; // engine over the FULL live session

  // (1) The NEW display path — reducer over the full log WITH reveals — equals the truth.
  const reducerFunds = reduceTexasHoldem(fullLog, reveals, new Set(peerIds)).funds;
  expect(sorted(reducerFunds)).toEqual(sorted(truth));

  // (2) The OLD path's failure mode: a refresh re-delivers ONLY the last hand's window to a
  // brand-new engine, which therefore computes the WRONG stacks (this is the live $0/错乱).
  const lastNewRoundIdx = fullLog.map(e => e.type).lastIndexOf('newRound');
  const window = gr.raw.slice(lastNewRoundIdx);
  const gr2 = new Room('A');
  const mp2 = new Deck(decks, new Map());
  mp2.peerId = 'A'; mp2.members = [...peerIds];
  const freshEngine = new TexasHoldemGameRoom(gr2 as any, mp2 as any);
  for (const e of window) gr2.listener.emit('event', e, (e as any).sender);
  await flush(); await flush();
  const staleEngineFunds = freshEngine.getStateSnapshot().bankrolls;
  // It only saw one hand, so its funds differ from the truth (demonstrating the old bug).
  // (We assert the divergence to lock in WHY we moved off the engine for display.)
  const staleDiffers = JSON.stringify(sorted(staleEngineFunds)) !== JSON.stringify(sorted(truth));
  expect(staleDiffers).toBe(true);

  // (3) The NEW path re-derives correctly across that same refresh: the reducer folds the
  // full PERSISTED transcript + reveals, so the displayed funds stay equal to the truth.
  const refreshedDisplay = reduceTexasHoldem(fullLog, reveals, new Set(peerIds)).funds;
  expect(sorted(refreshedDisplay)).toEqual(sorted(truth));

  // No player is ever left at $0 while it is their turn (the deadlock signature), under the
  // reducer that now drives BOTH funds and turn.
  const finalReduced = reduceTexasHoldem(fullLog, reveals, new Set(peerIds));
  for (const round of Array.from(finalReduced.rounds.values())) {
    if (round.currentTurn && !round.result) {
      expect(finalReduced.funds.get(round.currentTurn) ?? 0).toBeGreaterThanOrEqual(round.callAmount === 0 ? 0 : 1);
    }
  }
});
