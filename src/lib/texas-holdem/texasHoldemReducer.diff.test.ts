// Differential faithfulness test: drive the REAL stateful engine and the PURE reducer
// over the SAME random betting lines and assert they agree on pot / funds / whose turn /
// stage / folded / all-in / winner after every step. This is the contract that lets the
// reducer become the source of truth without changing any betting behavior — if the
// reducer ever drifts from the engine's math, this fails. (BROWSER_AUTHORITATIVE_REWORK
// _PLAN.md S1.)

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
import {
  reduceTexasHoldem,
  ReducerEvent,
  CardReveals,
} from "./texasHoldemReducer";

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

// Records every event that flows through the room (the canonical log) and forwards it to
// the engine, exactly like the broadcast relay echoing a signed event back.
class RecordingGameRoom implements GameRoomLike<TexasHoldemTableEvent> {
  peerIdAsync: Promise<string>;
  peerIdDeferred = new Deferred<string>();
  listener = new EventEmitter<GameRoomEvents<GameEvent<TexasHoldemTableEvent>>>();
  log: ReducerEvent[] = [];
  constructor(public localId: string) {
    this.peerIdAsync = this.peerIdDeferred.promise;
    this.peerIdDeferred.resolve(localId);
  }
  private record(sender: string, data: TexasHoldemTableEvent) {
    const e = data as any;
    this.log.push({
      type: e.type,
      from: sender,
      round: e.round,
      amount: e.amount,
      target: e.target,
      players: e.players,
      settings: e.settings,
    });
  }
  async emitEvent(e: GameEvent<TexasHoldemTableEvent>) {
    this.dispatch(e.sender as string, e.data as TexasHoldemTableEvent);
  }
  // Single path for both the local engine's own actions and injected opponent actions.
  dispatch(sender: string, data: TexasHoldemTableEvent) {
    this.record(sender, data);
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
  async dealCard(round: number, offset: number, _recipient: string) { this.emitCard(round, offset); }
}

const flush = () => new Promise<void>(r => setTimeout(r, 0));

function fundsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  const keys = new Set([...Array.from(a.keys()), ...Array.from(b.keys())]);
  for (const k of Array.from(keys)) {
    if ((a.get(k) ?? 0) !== (b.get(k) ?? 0)) return false;
  }
  return true;
}

function setEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of Array.from(a)) if (!b.has(x)) return false;
  return true;
}

describe('texasHoldemReducer differential vs the real engine', () => {
  jest.setTimeout(120000);

  test('reducer matches the engine on pot/funds/turn/stage/folded/allIn/winner every step', async () => {
    const rand = rng(0x5EED1);
    const SESSIONS = 40;

    for (let session = 0; session < SESSIONS; session++) {
      const n = 2 + Math.floor(rand() * 3); // 2..4 players
      const peerIds = Array.from({ length: n }, (_, i) => `p${i + 1}`);
      const decks = new Map<number, StandardCard[]>();
      const reveals: CardReveals = new Map();
      const gr = new RecordingGameRoom(peerIds[0]);
      const mp = new DeckMentalPoker(decks, reveals);
      mp.peerId = peerIds[0];
      mp.members = [...peerIds];
      const engine = new TexasHoldemGameRoom(gr as any, mp as any);
      const connected = new Set(peerIds);

      const compare = (label: string) => {
        const reduced = reduceTexasHoldem(gr.log, reveals, connected);
        const engineSnap = engine.getStateSnapshot();
        // funds
        expect({ label, funds: Array.from(reduced.funds.entries()).sort() })
          .toEqual({ label, funds: Array.from(engineSnap.bankrolls.entries()).sort() });
        const round = engineSnap.currentRound;
        if (round === undefined) return;
        const er = (engine as any).dataByRounds.get(round);
        const rr = reduced.rounds.get(round);
        if (!er || !rr) return;
        // pot per player + total
        expect({ label, pot: Array.from(rr.pot.entries()).sort() })
          .toEqual({ label, pot: Array.from(er.pot.entries()).sort() as [string, number][] });
        expect({ label, potAmount: reduced.potAmount }).toEqual({ label, potAmount: (engine as any).potAmount });
        // folded / all-in
        expect(setEqual(rr.folded, er.foldPlayers)).toBe(true);
        expect(setEqual(rr.allIn, er.allInPlayers)).toBe(true);
        // stage
        expect({ label, stage: rr.stage }).toEqual({ label, stage: er.stage });
        // winner
        const engineWinner = engineSnap.winnersByRound.get(round);
        // whose turn + call amount — only meaningful while the hand is LIVE. (On a
        // fold-win the engine leaves a stale whoseTurnByRound entry it never clears,
        // but its internal currentTurn IS null; the reducer reports the correct null.)
        if (!engineWinner && !rr.result) {
          const engineTurn = engineSnap.whoseTurnByRound.get(round) ?? null;
          expect({ label, turn: rr.currentTurn, call: rr.callAmount })
            .toEqual({ label, turn: engineTurn?.whoseTurn ?? null, call: engineTurn?.callAmount ?? 0 });
        }
        expect({ label, hasResult: !!rr.result, how: rr.result?.how })
          .toEqual({ label, hasResult: !!engineWinner, how: engineWinner?.how });
      };

      const HANDS = 1 + Math.floor(rand() * 4);
      for (let h = 0; h < HANDS; h++) {
        const roundNo = h + 1;
        decks.set(roundNo, shuffledDeck(rand));
        let started = false;
        try {
          await engine.startNewRound({ initialFundAmount: 100, participants: peerIds });
          started = true;
        } catch { started = false; }
        if (!started) break;
        await flush();
        compare(`s${session}h${h} start`);

        for (let step = 0; step < 200; step++) {
          await flush();
          const snap = engine.getStateSnapshot();
          if (snap.winnersByRound.get(roundNo)) break;
          const turn = snap.whoseTurnByRound.get(roundNo);
          if (!turn || !turn.whoseTurn) { await flush(); continue; }
          const who = turn.whoseTurn;
          const myFund = snap.bankrolls.get(who) ?? 0;
          const callAmount = Math.max(0, turn.callAmount ?? 0);
          const r = rand();
          if (r < 0.18 && callAmount > 0) {
            if (who === peerIds[0]) await engine.fold(roundNo);
            else gr.dispatch(who, { type: 'action/fold', round: roundNo } as TexasHoldemTableEvent);
          } else if (r < 0.30) {
            const amt = myFund; // all-in
            if (who === peerIds[0]) await engine.bet(roundNo, amt);
            else gr.dispatch(who, { type: 'action/bet', round: roundNo, amount: amt } as TexasHoldemTableEvent);
          } else if (r < 0.55) {
            const raise = 1 + Math.floor(rand() * 20);
            const amt = Math.min(myFund, callAmount + raise);
            if (who === peerIds[0]) await engine.bet(roundNo, amt);
            else gr.dispatch(who, { type: 'action/bet', round: roundNo, amount: amt } as TexasHoldemTableEvent);
          } else {
            const amt = Math.min(myFund, callAmount); // call/check
            if (who === peerIds[0]) await engine.bet(roundNo, amt);
            else gr.dispatch(who, { type: 'action/bet', round: roundNo, amount: amt } as TexasHoldemTableEvent);
          }
          await flush();
          compare(`s${session}h${h}step${step}`);
        }
        await flush();
        await flush();
        compare(`s${session}h${h} end`);
      }
      engine.close();
    }
  });
});
