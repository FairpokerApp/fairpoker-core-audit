// CHIP INTEGRITY AUDIT — detection only, changes no production code.
//
// Owner's worry: "金额都乱变". This is a permanent watchdog that fails CI if EITHER
//   (1) we miscalculate — chips get minted, destroyed, go negative, or a pot is not fully
//       redistributed (conservation), OR
//   (2) a user tampers — an illegal action (over-stack / out-of-turn / negative / post-fold)
//       changes anyone's chips.
//
// It drives the REAL engine (and the pure reducer) and asserts the invariants directly. It
// does not modify the engine; it only observes.

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
import { reduceTexasHoldem, ReducerEvent } from "./texasHoldemReducer";

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
  raw: ReducerEvent[] = [];
  constructor(localId: string) { this.peerIdAsync = this.peerIdDeferred.promise; this.peerIdDeferred.resolve(localId); }
  async emitEvent(e: GameEvent<TexasHoldemTableEvent>) { this.dispatch(e.sender as string, e.data as TexasHoldemTableEvent); }
  dispatch(sender: string, data: TexasHoldemTableEvent) {
    const d = data as any;
    this.raw.push({ type: d.type, from: sender, round: d.round, amount: d.amount, target: d.target, players: d.players, settings: d.settings });
    this.listener.emit('event', { type: 'public', sender, data } as GameEvent<TexasHoldemTableEvent>, sender);
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
const sumFunds = (e: TexasHoldemGameRoom) => Array.from(e.getStateSnapshot().bankrolls.values()).reduce((a, b) => a + b, 0);
const potOf = (e: TexasHoldemGameRoom, round: number) => {
  const rd = (e as any).dataByRounds.get(round);
  return rd ? Array.from(rd.pot.values() as Iterable<number>).reduce((a, b) => a + b, 0) : 0;
};
const fundsSnapshot = (e: TexasHoldemGameRoom) => JSON.stringify(Array.from(e.getStateSnapshot().bankrolls.entries()).sort());

describe('Chip integrity audit — conservation (we never miscalculate)', () => {
  jest.setTimeout(120000);

  test('across many random hands: chips are conserved, never negative, pot fully redistributed', async () => {
    const rand = rng(0xC0DE);
    const SESSIONS = 30;
    for (let s = 0; s < SESSIONS; s++) {
      const n = 2 + Math.floor(rand() * 3); // 2..4 players
      const peerIds = Array.from({ length: n }, (_, i) => `p${i + 1}`);
      const decks = new Map<number, StandardCard[]>();
      const gr = new Room(peerIds[0]);
      const mp = new Deck(decks);
      mp.peerId = peerIds[0];
      mp.members = [...peerIds];
      const engine = new TexasHoldemGameRoom(gr as any, mp as any);

      const HANDS = 1 + Math.floor(rand() * 4);
      for (let h = 0; h < HANDS; h++) {
        const round = h + 1;
        decks.set(round, shuffledDeck(rand));
        try { await engine.startNewRound({ initialFundAmount: 100, participants: peerIds }); } catch { break; }
        await flush();

        // Conserved quantity for THIS hand, captured after blinds (rebuy already applied).
        const total = sumFunds(engine) + potOf(engine, round);

        for (let step = 0; step < 200; step++) {
          await flush();
          const snap = engine.getStateSnapshot();
          if (snap.winnersByRound.get(round)) break;
          const turn = snap.whoseTurnByRound.get(round);
          if (!turn || !turn.whoseTurn) { await flush(); continue; }
          const who = turn.whoseTurn;
          const fund = snap.bankrolls.get(who) ?? 0;
          const call = Math.max(0, turn.callAmount ?? 0);
          const r = rand();
          const amt = r < 0.2 && call > 0 ? -1 /* fold */ : r < 0.35 ? fund /* all-in */ : Math.min(fund, call + Math.floor(rand() * 15));
          if (amt < 0) { who === peerIds[0] ? await engine.fold(round) : gr.dispatch(who, { type: 'action/fold', round } as TexasHoldemTableEvent); }
          else { who === peerIds[0] ? await engine.bet(round, amt) : gr.dispatch(who, { type: 'action/bet', round, amount: amt } as TexasHoldemTableEvent); }
          await flush();

          // INVARIANT (mid-hand): no chips minted/destroyed, none negative.
          const live = engine.getStateSnapshot();
          for (const v of Array.from(live.bankrolls.values())) {
            expect(Number.isInteger(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(0);
          }
          const resolved = !!live.winnersByRound.get(round);
          const conserved = resolved ? sumFunds(engine) : sumFunds(engine) + potOf(engine, round);
          expect(conserved).toBe(total); // chips conserved to the unit
        }
        await flush();
        await flush();
        // INVARIANT (resolved): the pot is fully redistributed into funds.
        expect(sumFunds(engine)).toBe(total);
      }
      engine.close();
    }
  });
});

describe('Chip integrity audit — tamper resistance (a user cannot change chips illegally)', () => {
  async function freshHand() {
    const peerIds = ['A', 'B', 'C'];
    const decks = new Map<number, StandardCard[]>();
    decks.set(1, getStandard52Deck());
    const gr = new Room('A');
    const mp = new Deck(decks);
    mp.peerId = 'A';
    mp.members = [...peerIds];
    const engine = new TexasHoldemGameRoom(gr as any, mp as any);
    await engine.startNewRound({ initialFundAmount: 100, participants: peerIds });
    await flush();
    return { engine, gr, peerIds };
  }

  test('a bet larger than the stack is rejected and changes no chips', async () => {
    const { engine, gr } = await freshHand();
    const who = engine.getStateSnapshot().whoseTurnByRound.get(1)!.whoseTurn;
    const before = fundsSnapshot(engine);
    gr.dispatch(who, { type: 'action/bet', round: 1, amount: 999999 } as TexasHoldemTableEvent);
    await flush();
    expect(fundsSnapshot(engine)).toBe(before); // over-stack bet ignored
  });

  test('a bet from a player whose turn it is NOT is rejected and changes no chips', async () => {
    const { engine, gr, peerIds } = await freshHand();
    const turn = engine.getStateSnapshot().whoseTurnByRound.get(1)!.whoseTurn;
    const notMyTurn = peerIds.find(p => p !== turn)!;
    const before = fundsSnapshot(engine);
    gr.dispatch(notMyTurn, { type: 'action/bet', round: 1, amount: 10 } as TexasHoldemTableEvent);
    await flush();
    expect(fundsSnapshot(engine)).toBe(before); // out-of-turn bet ignored
  });

  test('a negative / NaN / fractional / oversized bet is rejected (schema) and changes no chips', async () => {
    const { engine, gr } = await freshHand();
    const who = engine.getStateSnapshot().whoseTurnByRound.get(1)!.whoseTurn;
    const before = fundsSnapshot(engine);
    for (const bad of [-5, NaN, 3.5, Number.MAX_SAFE_INTEGER + 1, '10' as unknown as number]) {
      gr.dispatch(who, { type: 'action/bet', round: 1, amount: bad } as TexasHoldemTableEvent);
      await flush();
    }
    expect(fundsSnapshot(engine)).toBe(before); // every malformed amount ignored
  });

  test('a player who has folded cannot bet again to claw chips back', async () => {
    const { engine, gr, peerIds } = await freshHand();
    const turn = engine.getStateSnapshot().whoseTurnByRound.get(1)!.whoseTurn;
    gr.dispatch(turn, { type: 'action/fold', round: 1 } as TexasHoldemTableEvent);
    await flush();
    const before = fundsSnapshot(engine);
    gr.dispatch(turn, { type: 'action/bet', round: 1, amount: 10 } as TexasHoldemTableEvent); // folded → must be ignored
    await flush();
    expect(fundsSnapshot(engine)).toBe(before);
    expect(peerIds.length).toBe(3);
  });
});

describe('Chip integrity audit — the reducer cannot be tricked into minting chips', () => {
  const settings = { initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2 };
  test('an adversarial log (over-stack / out-of-turn / negative bets) never mints or loses chips', () => {
    // Two players, then a barrage of illegal bets injected into the log.
    const log: ReducerEvent[] = [
      { type: 'newRound', from: 'A', round: 1, players: ['A', 'B'], settings },
      { type: 'action/bet', from: 'B', round: 1, amount: 999999 }, // over-stack, out of turn
      { type: 'action/bet', from: 'A', round: 1, amount: -50 },    // negative
      { type: 'action/bet', from: 'B', round: 1, amount: 999999 }, // over-stack
      { type: 'action/bet', from: 'A', round: 1, amount: 1 },      // legal: SB completes
      { type: 'action/bet', from: 'A', round: 1, amount: 999999 }, // not A's turn now
    ];
    const s = reduceTexasHoldem(log, new Map(), ['A', 'B']);
    const r = s.rounds.get(1)!;
    const committed = Array.from(r.pot.values()).reduce((a, b) => a + b, 0);
    const funds = Array.from(s.funds.values()).reduce((a, b) => a + b, 0);
    // Total chips in play = 2 players * 100 (the rebuy). Nothing minted by the bad bets.
    expect(funds + committed).toBe(200);
    for (const v of Array.from(s.funds.values())) expect(v).toBeGreaterThanOrEqual(0);
    // The pot only holds the legal blinds + the legal SB completion (A:2, B:2), never the
    // 999999 garbage.
    expect(committed).toBe(4);
  });
});
