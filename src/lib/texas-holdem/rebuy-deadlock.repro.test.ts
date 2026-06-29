// EMPIRICAL reproduction of the live "$0 at hand start, can't act, 全下 says 筹码不足"
// deadlock (2026-06-29 screenshots). A player whose stack is below one big blind MUST be
// auto-rebought at the next hand. We drive the REAL engine through the exact lifecycle a
// reconnect produces (the relay re-delivers the current hand's events as replay=true) and
// assert the busted player is topped up — and that whose-turn never points at a $0 stack.

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

class Room implements GameRoomLike<TexasHoldemTableEvent> {
  peerIdAsync: Promise<string>;
  peerIdDeferred = new Deferred<string>();
  listener = new EventEmitter<GameRoomEvents<GameEvent<TexasHoldemTableEvent>>>();
  raw: GameEvent<TexasHoldemTableEvent>[] = [];
  constructor(localId: string) { this.peerIdAsync = this.peerIdDeferred.promise; this.peerIdDeferred.resolve(localId); }
  async emitEvent(e: GameEvent<TexasHoldemTableEvent>) { this.dispatch(e.sender as string, e.data as TexasHoldemTableEvent); }
  dispatch(sender: string, data: TexasHoldemTableEvent) {
    const e = { type: 'public', sender, data } as GameEvent<TexasHoldemTableEvent>;
    this.raw.push(e);
    this.listener.emit('event', e, sender, false);
  }
  // Replay the current hand's events as the relay does on reconnect (replay=true).
  replayFrom(round: number) {
    for (const e of this.raw) {
      if ((e.data as any).round === round || (e.data as any).type === 'newRound' && (e.data as any).round === round) {
        this.listener.emit('event', e, (e as any).sender, true);
      }
    }
  }
}
class Deck implements MentalPokerGameRoomLike {
  round = 0;
  listener = new EventEmitter<MentalPokerGameRoomEvents>();
  members: string[] = [];
  peerId?: string;
  constructor(private decks: Map<number, StandardCard[]>) {}
  hasIndividualKeysForRound() { return true; }
  wipeRoundSecrets() {}
  async startNewRound(_s: MentalPokerRoundSettings) { const r = ++this.round; setTimeout(() => this.listener.emit('shuffled'), 0); return r; }
  private emit(round: number, offset: number) { const d = this.decks.get(round); if (d && d[offset]) this.listener.emit('card', round, offset, d[offset]); }
  async showCard(round: number, offset: number) { this.emit(round, offset); }
  async dealCard(round: number, offset: number) { this.emit(round, offset); }
}
const flush = () => new Promise<void>(r => setTimeout(r, 0));

async function playHandToEnd(engine: TexasHoldemGameRoom, gr: Room, round: number, drive: (who: string, fund: number, call: number) => number) {
  for (let step = 0; step < 100; step++) {
    await flush();
    const snap = engine.getStateSnapshot();
    if (snap.winnersByRound.get(round)) break;
    const turn = snap.whoseTurnByRound.get(round);
    if (!turn || !turn.whoseTurn) { await flush(); continue; }
    const who = turn.whoseTurn;
    const fund = snap.bankrolls.get(who) ?? 0;
    const call = Math.max(0, turn.callAmount ?? 0);
    const amt = drive(who, fund, call);
    if (amt < 0) { who === 'A' ? await engine.fold(round) : gr.dispatch(who, { type: 'action/fold', round } as TexasHoldemTableEvent); }
    else { who === 'A' ? await engine.bet(round, amt) : gr.dispatch(who, { type: 'action/bet', round, amount: amt } as TexasHoldemTableEvent); }
  }
  await flush(); await flush();
}

test('a player below the big blind is auto-rebought at the next hand, even after a reconnect replay', async () => {
  const peerIds = ['A', 'B'];
  const decks = new Map<number, StandardCard[]>();
  const gr = new Room('A');
  const mp = new Deck(decks);
  mp.peerId = 'A';
  mp.members = [...peerIds];
  const engine = new TexasHoldemGameRoom(gr as any, mp as any);
  const SB = 1, BB = 2, INIT = 100;

  // Hand 1: drive B to bust (B goes all-in, A calls and wins by showdown OR B folds away
  // chips). Simplest deterministic bust: B shoves, A calls, whoever wins — then we force
  // B's stack below BB to model the busted friend.
  decks.set(1, getStandard52Deck());
  await engine.startNewRound({ initialFundAmount: INIT, smallBlindAmount: SB, bigBlindAmount: BB, participants: peerIds });
  await flush();
  await playHandToEnd(engine, gr, 1, (who, fund, call) => (who === 'A' ? -1 /* A folds */ : call));
  // A folded → B wins hand 1. Now force B to a sub-BB stack to model "almost busted".
  (engine as any).funds.set('B', 1);
  (engine as any).funds.set('A', 1);

  // RECONNECT before hand 2: the relay re-delivers hand 1's events as replay=true.
  gr.replayFrom(1);
  await flush();

  // Hand 2 starts. Both A and B are below BB ($1 each) → BOTH must be auto-rebought.
  decks.set(2, getStandard52Deck());
  await engine.startNewRound({ initialFundAmount: INIT, smallBlindAmount: SB, bigBlindAmount: BB, participants: peerIds });
  await flush();

  const snap = engine.getStateSnapshot();
  const fundA = snap.bankrolls.get('A') ?? 0;
  const fundB = snap.bankrolls.get('B') ?? 0;

  // After rebuy(+100) and blinds (SB=1 / BB=2 on the two seats), nobody is at $0.
  expect(fundA).toBeGreaterThan(0);
  expect(fundB).toBeGreaterThan(0);
  // Whose-turn must never point at a $0 stack with chips owed (the deadlock).
  const turn = snap.whoseTurnByRound.get(2);
  if (turn?.whoseTurn) {
    expect(snap.bankrolls.get(turn.whoseTurn) ?? 0).toBeGreaterThan(0);
  }
  // Conservation: each started at 1, both rebought +100 → 202 total, all of it on the table.
  const potTotal = Array.from(((engine as any).dataByRounds.get(2)?.pot.values() ?? []) as Iterable<number>).reduce((a: number, b: number) => a + b, 0);
  expect(fundA + fundB + potTotal).toBe(202);
});
