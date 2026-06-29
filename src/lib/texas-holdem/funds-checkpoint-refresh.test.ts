// Stage 1 of the durable-state fix: a funds checkpoint persisted between hands lets a
// refreshing/reopening client re-derive CORRECT bankrolls even though the relay only
// replays the CURRENT hand (it cannot return the full history). This test reproduces the
// live bug — a reopened client recomputing funds from a blank slate (everyone reset to the
// rebuy amount) — and proves the checkpoint fixes it.
//
// Models reality: client drives N hands and accumulates the FULL log; on "reopen" only the
// CURRENT hand's events survive (the relay window). Without the checkpoint the reducer over
// that window is wrong; seeded with the between-hands checkpoint it matches the never-closed
// client exactly.

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
class Room implements GameRoomLike<TexasHoldemTableEvent> {
  peerIdAsync: Promise<string>; peerIdDeferred = new Deferred<string>();
  listener = new EventEmitter<GameRoomEvents<GameEvent<TexasHoldemTableEvent>>>();
  log: ReducerEvent[] = [];
  constructor(id: string) { this.peerIdAsync = this.peerIdDeferred.promise; this.peerIdDeferred.resolve(id); }
  async emitEvent(e: GameEvent<TexasHoldemTableEvent>) { this.dispatch(e.sender as string, e.data as TexasHoldemTableEvent); }
  dispatch(sender: string, data: TexasHoldemTableEvent) {
    const d = data as any;
    this.log.push({ type: d.type, from: sender, round: d.round, amount: d.amount, target: d.target, players: d.players, settings: d.settings });
    this.listener.emit('event', { type: 'public', sender, data } as GameEvent<TexasHoldemTableEvent>, sender, false);
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
const flush = () => new Promise<void>(r => setTimeout(r, 0));
const sorted = (m: Map<string, number>) => Array.from(m.entries()).sort();

test('a funds checkpoint lets a reopened client (current-hand window only) match the never-closed client', async () => {
  const rand = rng(0x5151);
  const peerIds = ['A', 'B'];
  const decks = new Map<number, StandardCard[]>();
  const reveals: CardReveals = new Map();
  const gr = new Room('A');
  const mp = new Deck(decks, reveals); mp.peerId = 'A'; mp.members = [...peerIds];
  const engine = new TexasHoldemGameRoom(gr as any, mp as any);

  // Capture a between-hands checkpoint after each hand resolves (what the live save effect
  // does): throughRound = last resolved round, funds/boughtIn = the clean post-hand state.
  let checkpoint: FundsCheckpoint | undefined;
  const captureCheckpoint = () => {
    const s = reduceTexasHoldem(gr.log, reveals, new Set(peerIds));
    if (!s.handInProgress && s.resolvedRounds.length) {
      checkpoint = { throughRound: Math.max(...s.resolvedRounds), funds: new Map(s.funds), boughtIn: new Map(s.boughtIn) };
    }
  };

  const HANDS = 6;
  let lastWindowStartIdx = 0;
  for (let h = 0; h < HANDS; h++) {
    const round = h + 1;
    lastWindowStartIdx = gr.log.length; // the current hand's events begin here (relay window)
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
    captureCheckpoint(); // saved between hands, like the live effect
  }

  // Start ONE more hand so a hand is live when we "reopen" (the realistic case).
  const liveRound = HANDS + 1;
  lastWindowStartIdx = gr.log.length;
  decks.set(liveRound, shuffledDeck(rand));
  await engine.startNewRound({ initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2, participants: peerIds });
  await flush(); await flush();

  // TRUTH: the client that never closed has the full log → correct funds.
  const truth = reduceTexasHoldem(gr.log, reveals, new Set(peerIds)).funds;

  // REOPEN: only the current hand's events survive (the relay window). The persisted
  // history gives reveals for past hands but the LOG is just this hand.
  const windowLog = gr.log.slice(lastWindowStartIdx);

  // (a) WITHOUT the checkpoint: the reducer rebuys everyone from scratch → WRONG.
  const noCheckpoint = reduceTexasHoldem(windowLog, reveals, new Set(peerIds)).funds;
  expect(JSON.stringify(sorted(noCheckpoint)) !== JSON.stringify(sorted(truth))).toBe(true);

  // (b) WITH the checkpoint: seeded funds + the live hand applied on top → MATCHES truth.
  expect(checkpoint).toBeDefined();
  const withCheckpoint = reduceTexasHoldem(windowLog, reveals, new Set(peerIds), checkpoint).funds;
  expect(sorted(withCheckpoint)).toEqual(sorted(truth));
});
