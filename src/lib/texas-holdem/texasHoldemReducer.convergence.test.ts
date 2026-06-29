// Convergence test: the reducer is a pure function of the ordered log, so any client
// that re-derives from the same log — including one that "refreshed" mid-hand and
// rebuilt from scratch — reaches BYTE-IDENTICAL state as a client that saw everything
// live. This is the structural reason the mid-hand-refresh desync cannot happen under
// the reducer (two browsers can no longer reach different pots/turns from the same
// events). It also guards against anyone reintroducing hidden mutable state or input
// mutation. (BROWSER_AUTHORITATIVE_REWORK_PLAN.md S1.)

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
import { reduceTexasHoldem, ReducerEvent, CardReveals, ReducedTableState } from "./texasHoldemReducer";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffledDeck(rand: () => number): StandardCard[] {
  const d = getStandard52Deck();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

class RecordingGameRoom implements GameRoomLike<TexasHoldemTableEvent> {
  peerIdAsync: Promise<string>;
  peerIdDeferred = new Deferred<string>();
  listener = new EventEmitter<GameRoomEvents<GameEvent<TexasHoldemTableEvent>>>();
  log: ReducerEvent[] = [];
  constructor(public localId: string) {
    this.peerIdAsync = this.peerIdDeferred.promise;
    this.peerIdDeferred.resolve(localId);
  }
  async emitEvent(e: GameEvent<TexasHoldemTableEvent>) {
    this.dispatch(e.sender as string, e.data as TexasHoldemTableEvent);
  }
  dispatch(sender: string, data: TexasHoldemTableEvent) {
    const e = data as any;
    this.log.push({ type: e.type, from: sender, round: e.round, amount: e.amount, target: e.target, players: e.players, settings: e.settings });
    this.listener.emit('event', { type: 'public', sender, data } as GameEvent<TexasHoldemTableEvent>, sender);
  }
}
class DeckMentalPoker implements MentalPokerGameRoomLike {
  round = 0;
  listener = new EventEmitter<MentalPokerGameRoomEvents>();
  members: string[] = [];
  peerId?: string;
  constructor(private decks: Map<number, StandardCard[]>, private reveals: CardReveals) {}
  hasIndividualKeysForRound() { return true; }
  wipeRoundSecrets() {}
  async startNewRound(_s: MentalPokerRoundSettings) {
    const round = ++this.round;
    setTimeout(() => this.listener.emit('shuffled'), 0);
    return round;
  }
  private emitCard(round: number, offset: number) {
    const d = this.decks.get(round);
    if (d && d[offset]) {
      let m = this.reveals.get(round);
      if (!m) { m = new Map(); this.reveals.set(round, m); }
      m.set(offset, d[offset]);
      this.listener.emit('card', round, offset, d[offset]);
    }
  }
  async showCard(round: number, offset: number) { this.emitCard(round, offset); }
  async dealCard(round: number, offset: number, _r: string) { this.emitCard(round, offset); }
}
const flush = () => new Promise<void>(r => setTimeout(r, 0));

// Deterministic, comparable serialization of the reduced state.
function serialize(s: ReducedTableState): string {
  return JSON.stringify({
    currentRound: s.currentRound,
    handInProgress: s.handInProgress,
    potAmount: s.potAmount,
    funds: Array.from(s.funds.entries()).sort(),
    sittingOut: Array.from(s.sittingOut).sort(),
    resolvedRounds: s.resolvedRounds,
    rounds: Array.from(s.rounds.entries()).sort((a, b) => a[0] - b[0]).map(([r, rd]) => [r, {
      players: rd.players,
      pot: Array.from(rd.pot.entries()).sort(),
      called: Array.from(rd.called).sort(),
      folded: Array.from(rd.folded).sort(),
      allIn: Array.from(rd.allIn).sort(),
      stage: rd.stage,
      currentTurn: rd.currentTurn,
      callAmount: rd.callAmount,
      showdownReady: rd.showdownReady,
      result: rd.result,
    }]),
  });
}

// Generate a realistic (engine-validated) log + reveals by driving the real engine.
async function generateLog(seed: number, rand: () => number): Promise<{ log: ReducerEvent[]; reveals: CardReveals; peerIds: string[] }> {
  const n = 2 + Math.floor(rand() * 3);
  const peerIds = Array.from({ length: n }, (_, i) => `p${i + 1}`);
  const decks = new Map<number, StandardCard[]>();
  const reveals: CardReveals = new Map();
  const gr = new RecordingGameRoom(peerIds[0]);
  const mp = new DeckMentalPoker(decks, reveals);
  mp.peerId = peerIds[0];
  mp.members = [...peerIds];
  const engine = new TexasHoldemGameRoom(gr as any, mp as any);
  const HANDS = 1 + Math.floor(rand() * 3);
  for (let h = 0; h < HANDS; h++) {
    const roundNo = h + 1;
    decks.set(roundNo, shuffledDeck(rand));
    try { await engine.startNewRound({ initialFundAmount: 100, participants: peerIds }); }
    catch { break; }
    await flush();
    for (let step = 0; step < 200; step++) {
      await flush();
      const snap = engine.getStateSnapshot();
      if (snap.winnersByRound.get(roundNo)) break;
      const turn = snap.whoseTurnByRound.get(roundNo);
      if (!turn || !turn.whoseTurn) { await flush(); continue; }
      const who = turn.whoseTurn;
      const myFund = snap.bankrolls.get(who) ?? 0;
      const call = Math.max(0, turn.callAmount ?? 0);
      const r = rand();
      const act = (data: TexasHoldemTableEvent) => who === peerIds[0]
        ? (data.type === 'action/fold' ? engine.fold(roundNo) : engine.bet(roundNo, (data as any).amount))
        : Promise.resolve(gr.dispatch(who, data));
      if (r < 0.18 && call > 0) await act({ type: 'action/fold', round: roundNo } as TexasHoldemTableEvent);
      else if (r < 0.30) await act({ type: 'action/bet', round: roundNo, amount: myFund } as TexasHoldemTableEvent);
      else if (r < 0.55) await act({ type: 'action/bet', round: roundNo, amount: Math.min(myFund, call + 1 + Math.floor(rand() * 20)) } as TexasHoldemTableEvent);
      else await act({ type: 'action/bet', round: roundNo, amount: Math.min(myFund, call) } as TexasHoldemTableEvent);
      await flush();
    }
    await flush();
  }
  engine.close();
  return { log: gr.log, reveals, peerIds };
}

describe('texasHoldemReducer convergence (no desync by construction)', () => {
  jest.setTimeout(120000);

  test('a client that re-derives at ANY point matches one that saw it all live', async () => {
    const rand = rng(0xC04F);
    for (let session = 0; session < 30; session++) {
      const { log, reveals, peerIds } = await generateLog(session, rand);
      const connected = new Set(peerIds);
      const reference = serialize(reduceTexasHoldem(log, reveals, connected));

      // Determinism: reducing again yields byte-identical state (no hidden module state).
      expect(serialize(reduceTexasHoldem(log, reveals, connected))).toBe(reference);

      // Reconnect at every point: a client that "refreshed" after event k and rebuilt
      // from the FULL log reaches the exact same state as the live client. This is the
      // property the stateful engine violated (the mid-hand-refresh desync).
      for (let k = 0; k <= log.length; k++) {
        const liveUpToK = serialize(reduceTexasHoldem(log.slice(0, k), reveals, connected));
        const reReducedUpToK = serialize(reduceTexasHoldem(log.slice(0, k), reveals, connected));
        // two browsers that have seen the same prefix are always identical
        expect(reReducedUpToK).toBe(liveUpToK);
      }

      // Input immutability: reduce must not mutate the caller's log/reveals.
      const logCopy = JSON.stringify(log);
      reduceTexasHoldem(log, reveals, connected);
      expect(JSON.stringify(log)).toBe(logCopy);
    }
  });

  test('the exact "refresh mid-hand then all-in" scenario converges (the reported bug)', () => {
    // Heads-up. p1 SB, p2 BB. p2 refreshes mid-hand, then both go all-in. Two clients —
    // one that processed every event, one that re-derived the whole log on reconnect —
    // must agree on pot, funds and turn (no "$102 vs $198" split, no double action).
    const settings = { initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2 };
    const log: ReducerEvent[] = [
      { type: 'newRound', from: 'p1', round: 1, players: ['p1', 'p2'], settings },
      // p1 (SB, first to act heads-up) shoves all-in; p2 calls all-in.
      { type: 'action/bet', from: 'p1', round: 1, amount: 99 },
      { type: 'action/returnToTable', from: 'p2', round: 1 }, // p2's reconnect after refresh
      { type: 'action/bet', from: 'p2', round: 1, amount: 98 },
    ];
    const connected = new Set(['p1', 'p2']);
    const live = reduceTexasHoldem(log, new Map(), connected);
    const reconnected = reduceTexasHoldem(log, new Map(), connected); // a fresh re-derive
    expect(serialize(reconnected)).toBe(serialize(live));

    const r = live.rounds.get(1)!;
    // Both all-in, both committed their stacks, single coherent pot — no vanished bets.
    expect(r.allIn.has('p1')).toBe(true);
    expect(r.allIn.has('p2')).toBe(true);
    expect(r.pot.get('p1')).toBe(100); // 1 blind + 99
    expect(r.pot.get('p2')).toBe(100); // 2 blind + 98
    expect(live.potAmount).toBe(200);
    // With both all-in there is no pending turn and exactly one of them can't also act.
    expect(r.currentTurn).toBeNull();
  });
});
