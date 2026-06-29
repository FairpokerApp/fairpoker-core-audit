// Regression: a reconnect replays the current hand's events (the handStartSeq window), so
// the engine can re-receive a `newRound` it already processed. handleNewRoundEvent used to
// re-run the auto-rebuy AND re-post the blinds each time, corrupting funds ("messy chips":
// a busted friend topped up twice / blinds double-deducted / a player stuck at $0). It must
// now be idempotent: re-processing a round that's already set up is a no-op for funds.

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
  async startNewRound(_s: MentalPokerRoundSettings) { return ++this.round; }
  async showCard() {}
  async dealCard() {}
}
const flush = () => new Promise<void>(r => setTimeout(r, 0));
const newRound = (replay: boolean, gr: MockGameRoom) =>
  gr.listener.emit(
    'event',
    { type: 'public', sender: 'A', data: { type: 'newRound', round: 1, players: ['A', 'B'], settings: { initialFundAmount: 100 } } } as GameEvent<TexasHoldemTableEvent>,
    'A',
    replay,
  );

test('re-processing a newRound (reconnect replay) does not re-rebuy or re-post blinds', async () => {
  const gameRoom = new MockGameRoom();
  gameRoom.peerIdDeferred.resolve('A');
  const mp = new MockMentalPokerGameRoom();
  mp.peerId = 'A';
  mp.members = ['A', 'B'];
  const engine = new TexasHoldemGameRoom(gameRoom, mp);

  // First (live) newRound: both auto-rebuy to 100, then SB=1 / BB=2 → A 99, B 98.
  newRound(false, gameRoom);
  await flush();
  const after = engine.getStateSnapshot().bankrolls;
  expect(after.get('A')).toBe(99);
  expect(after.get('B')).toBe(98);
  const pot = (engine as any).potAmount;

  // Reconnect replays the SAME newRound — must be a no-op (no second blind deduction).
  newRound(true, gameRoom);
  await flush();
  newRound(true, gameRoom); // and again, for good measure
  await flush();

  const replayed = engine.getStateSnapshot().bankrolls;
  expect(replayed.get('A')).toBe(99); // would be 98/97 if blinds re-posted
  expect(replayed.get('B')).toBe(98); // would be 96/94 if blinds re-posted
  expect((engine as any).potAmount).toBe(pot); // pot unchanged
});

test('a busted player is still topped up at a genuinely NEW round', async () => {
  const gameRoom = new MockGameRoom();
  gameRoom.peerIdDeferred.resolve('A');
  const mp = new MockMentalPokerGameRoom();
  mp.peerId = 'A';
  mp.members = ['A', 'B'];
  const engine = new TexasHoldemGameRoom(gameRoom, mp);

  newRound(false, gameRoom);
  await flush();
  // Simulate B busting to 0 (as if they lost an all-in).
  (engine as any).funds.set('B', 0);

  // A genuinely new round (round 2) must still auto-rebuy B.
  gameRoom.listener.emit('event', { type: 'public', sender: 'A', data: { type: 'newRound', round: 2, players: ['A', 'B'], settings: { initialFundAmount: 100 } } } as GameEvent<TexasHoldemTableEvent>, 'A', false);
  await flush();
  // B rebought to 100, then posts BB(2) → 98 (B is players[1] again).
  expect(engine.getStateSnapshot().bankrolls.get('B')).toBe(98);
});
