// Reproduction for the live "refresh while all-in stalls 30s" bug (factor ④).
//
// When every player is ALL-IN there is no current turn — the hand only waits for
// the board reveal + showdown. If a player disconnects (refresh) and then returns,
// handleReturnToTableEvent should RESUME them (clear the pause) so the showdown can
// proceed. The bug: because it is not their "turn", the returning all-in player was
// instead sat out and the hand re-paused, stranding the showdown until the 30s stall
// watchdog voids it.
//
// This test asserts the FIXED behavior: a returning all-in player is no longer
// paused/sat-out. (Run before the fix to confirm the repro fails.)

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

class MockGameRoom implements GameRoomLike<TexasHoldemTableEvent> {
  peerIdAsync: Promise<string>;
  peerIdDeferred = new Deferred<string>();
  listener = new EventEmitter<GameRoomEvents<GameEvent<TexasHoldemTableEvent>>>();
  constructor() { this.peerIdAsync = this.peerIdDeferred.promise; }
  async emitEvent(e: GameEvent<TexasHoldemTableEvent>) {
    this.listener.emit('event', e, await this.peerIdAsync);
  }
}

class MockMentalPokerGameRoom implements MentalPokerGameRoomLike {
  round = 0;
  listener = new EventEmitter<MentalPokerGameRoomEvents>();
  members: string[] = [];
  peerId?: string;
  hasIndividualKeysForRound() { return true; }
  wipeRoundSecrets() {}
  async startNewRound(_s: MentalPokerRoundSettings) {
    const round = ++this.round;
    setTimeout(() => this.listener.emit('shuffled'), 0);
    return round;
  }
  async showCard() {}
  async dealCard() {}
}

const flush = () => new Promise<void>(r => setTimeout(r, 0));
const emitFrom = (gr: MockGameRoom, sender: string, data: TexasHoldemTableEvent) =>
  gr.listener.emit('event', { type: 'public', sender, data } as GameEvent<TexasHoldemTableEvent>, sender);

test('a returning ALL-IN player resumes the showdown instead of being sat out and re-paused', async () => {
  const gameRoom = new MockGameRoom();
  gameRoom.peerIdDeferred.resolve('A');
  const mp = new MockMentalPokerGameRoom();
  mp.peerId = 'A';
  mp.members = ['A', 'B'];
  const engine = new TexasHoldemGameRoom(gameRoom, mp);

  await engine.startNewRound({ initialFundAmount: 100, participants: ['A', 'B'] });
  await flush();

  // Drive both players all-in (each bets their whole stack) until there is no turn.
  for (let i = 0; i < 8; i++) {
    await flush();
    const snap = engine.getStateSnapshot();
    const turn = snap.whoseTurnByRound.get(1);
    if (!turn || !turn.whoseTurn) break;
    const who = turn.whoseTurn;
    const fund = snap.bankrolls.get(who) ?? 0;
    if (who === 'A') {
      await engine.bet(1, fund);
    } else {
      emitFrom(gameRoom, who, { type: 'action/bet', round: 1, amount: fund } as TexasHoldemTableEvent);
    }
  }
  await flush();

  const round = (engine as any).dataByRounds.get(1);
  // Sanity: both are all-in and there is no pending turn.
  expect(round.allInPlayers.has('A')).toBe(true);
  expect(round.allInPlayers.has('B')).toBe(true);
  expect(round.currentTurn ?? null).toBeNull();

  // B drops (refresh) — the hand pauses on B.
  mp.members = ['A'];
  mp.listener.emit('members', ['A']);
  await flush();

  // B reopens and returns to the table.
  mp.members = ['A', 'B'];
  mp.listener.emit('members', ['A', 'B']);
  await flush();
  emitFrom(gameRoom, 'B', { type: 'action/returnToTable', round: 1 } as TexasHoldemTableEvent);
  await flush();

  // FIXED behavior: B is back in the showdown — not paused, not sat out.
  expect(round.pausedMissingPlayers).not.toContain('B');
  expect((engine as any).sittingOutPlayers.has('B')).toBe(false);
});
