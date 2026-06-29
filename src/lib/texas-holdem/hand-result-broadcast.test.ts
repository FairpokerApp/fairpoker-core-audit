// Verifies the client side of the hand-end signal: when the engine resolves a hand
// it broadcasts exactly one signed `hand/result` table event for that round. The
// relay consumes this event to clear the round (see the worker
// hand-result-clears-round.test.mjs), which is what unblocks the next hand after a
// disconnect/refresh. (State-rework Stage 1 / AUDIT_ALIGNED_STATE_REWORK_PLAN §6.)

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

// Records every event the engine emits, then forwards it to the listener (so the
// engine still processes its own events exactly like the broadcast relay echo).
class CapturingGameRoom implements GameRoomLike<TexasHoldemTableEvent> {
  peerIdAsync: Promise<string>;
  peerIdDeferred = new Deferred<string>();
  listener = new EventEmitter<GameRoomEvents<GameEvent<TexasHoldemTableEvent>>>();
  emitted: GameEvent<TexasHoldemTableEvent>[] = [];
  constructor() { this.peerIdAsync = this.peerIdDeferred.promise; }
  async emitEvent(e: GameEvent<TexasHoldemTableEvent>) {
    this.emitted.push(e);
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
const emitFrom = (gr: CapturingGameRoom, sender: string, data: TexasHoldemTableEvent) =>
  gr.listener.emit('event', { type: 'public', sender, data } as GameEvent<TexasHoldemTableEvent>, sender);

function handResultEvents(gr: CapturingGameRoom) {
  return gr.emitted.filter(e => (e.data as { type?: string }).type === 'hand/result');
}

test('resolving a hand broadcasts exactly one signed hand/result for that round', async () => {
  const gameRoom = new CapturingGameRoom();
  gameRoom.peerIdDeferred.resolve('A');
  const mp = new MockMentalPokerGameRoom();
  mp.peerId = 'A';
  mp.members = ['A', 'B'];
  const engine = new TexasHoldemGameRoom(gameRoom, mp);

  await engine.startNewRound({ initialFundAmount: 100, participants: ['A', 'B'] });
  await flush();

  // Drive the hand to a fold-out (LastOneWins): the first player to act folds.
  for (let i = 0; i < 8; i++) {
    await flush();
    const snap = engine.getStateSnapshot();
    if (snap.winnersByRound.get(1)) break;
    const turn = snap.whoseTurnByRound.get(1);
    if (!turn || !turn.whoseTurn) { await flush(); continue; }
    const who = turn.whoseTurn;
    if (who === 'A') {
      await engine.fold(1);
    } else {
      emitFrom(gameRoom, who, { type: 'action/fold', round: 1 } as TexasHoldemTableEvent);
    }
  }
  await flush();
  await flush();

  expect(engine.getStateSnapshot().winnersByRound.get(1)).toBeTruthy();

  const results = handResultEvents(gameRoom);
  expect(results).toHaveLength(1);
  expect(results[0].type).toBe('public');
  expect((results[0].data as { round: number }).round).toBe(1);
});

test('a hand/result echoed back from the relay does not trigger another broadcast', async () => {
  // Idempotency at the client: receiving its own (or a peer's) hand/result must not
  // make this client emit a second one.
  const gameRoom = new CapturingGameRoom();
  gameRoom.peerIdDeferred.resolve('A');
  const mp = new MockMentalPokerGameRoom();
  mp.peerId = 'A';
  mp.members = ['A', 'B'];
  const engine = new TexasHoldemGameRoom(gameRoom, mp);

  await engine.startNewRound({ initialFundAmount: 100, participants: ['A', 'B'] });
  await flush();
  for (let i = 0; i < 8; i++) {
    await flush();
    const snap = engine.getStateSnapshot();
    if (snap.winnersByRound.get(1)) break;
    const turn = snap.whoseTurnByRound.get(1);
    if (!turn || !turn.whoseTurn) { await flush(); continue; }
    const who = turn.whoseTurn;
    if (who === 'A') await engine.fold(1);
    else emitFrom(gameRoom, who, { type: 'action/fold', round: 1 } as TexasHoldemTableEvent);
  }
  await flush();
  await flush();
  const countAfterResolve = handResultEvents(gameRoom).length;

  // Peer B re-broadcasts a hand/result for the same round; A must not echo a new one.
  emitFrom(gameRoom, 'B', { type: 'hand/result', round: 1 } as TexasHoldemTableEvent);
  await flush();

  expect(handResultEvents(gameRoom).length).toBe(countAfterResolve);
  expect(countAfterResolve).toBe(1);
});
