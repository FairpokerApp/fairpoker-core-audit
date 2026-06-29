// Seating/lifecycle view of the unified reducer — the browser-authoritative replacement
// for the Worker's roomState. Asserts the live semantics: lobby seats everyone reachable,
// a mid-hand disconnect is transient 'missing' (rejoins on reconnect, no sticky lock-out),
// sit-out/return toggles the seat, and a finished hand re-seats everyone for the next hand
// (the livelock fix). (BROWSER_AUTHORITATIVE_REWORK_PLAN.md S3.)

import { reduceTexasHoldem, ReducerEvent } from "./texasHoldemReducer";

const settings = { initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2 };
const newRound = (round: number, players: string[]): ReducerEvent =>
  ({ type: 'newRound', from: players[0], round, players, settings });
const handResult = (round: number, from: string): ReducerEvent =>
  ({ type: 'hand/result', from, round });
const sitOut = (from: string): ReducerEvent => ({ type: 'action/sitOut', from });
const returnToTable = (from: string): ReducerEvent => ({ type: 'action/returnToTable', from });

function statusOf(state: ReturnType<typeof reduceTexasHoldem>, peer: string) {
  return state.seatPlayers.find(p => p.peerId === peer)?.status;
}

test('lobby: everyone reachable and not sitting out is seated for the next hand', () => {
  const s = reduceTexasHoldem([], new Map(), ['A', 'B', 'C']);
  expect(s.seatedForNextHand.sort()).toEqual(['A', 'B', 'C']);
  expect(s.playable).toBe(true);
  expect(statusOf(s, 'A')).toBe('active');
});

test('a single reachable player cannot start a hand', () => {
  const s = reduceTexasHoldem([], new Map(), ['A']);
  expect(s.playable).toBe(false);
});

test('mid-hand disconnect is transient "missing", and reconnect restores the seat', () => {
  const log = [newRound(1, ['A', 'B'])];
  // B is unreachable mid-hand.
  const dropped = reduceTexasHoldem(log, new Map(), ['A']);
  expect(statusOf(dropped, 'B')).toBe('missing');
  expect(dropped.missingPlayers).toEqual(['B']);
  // B reconnects → back to active, no sticky lock-out.
  const back = reduceTexasHoldem(log, new Map(), ['A', 'B']);
  expect(statusOf(back, 'B')).toBe('active');
  expect(back.missingPlayers).toEqual([]);
});

test('a deliberate sit-out drops the seat; returning takes it back', () => {
  const out = reduceTexasHoldem([newRound(1, ['A', 'B', 'C']), sitOut('C')], new Map(), ['A', 'B', 'C']);
  expect(statusOf(out, 'C')).toBe('sittingOut');
  expect(out.seatedForNextHand).not.toContain('C');
  const backIn = reduceTexasHoldem(
    [newRound(1, ['A', 'B', 'C']), sitOut('C'), returnToTable('C')], new Map(), ['A', 'B', 'C'],
  );
  expect(statusOf(backIn, 'C')).toBe('active');
});

test('after a hand ends, a player who dropped then returned is re-seated for the next hand (livelock fix)', () => {
  // A refreshes mid-hand (modeled by returnToTable), the hand ends, and the table must
  // re-seat both for the next hand — no stranded "已离座", no dead-locked next hand.
  const log = [newRound(1, ['A', 'B']), returnToTable('A'), handResult(1, 'B')];
  const s = reduceTexasHoldem(log, new Map(), ['A', 'B']);
  expect(s.handInProgress).toBe(false);
  expect(s.seatedForNextHand.sort()).toEqual(['A', 'B']);
  expect(s.playable).toBe(true);
});

test("the relay's system identity 'worker-relay' is never seated or listed as a player", () => {
  // Defense-in-depth: even if 'worker-relay' leaks into the connected set or appears as an
  // event sender (e.g. a replayed system/peerLeft on reconnect), it must never become a
  // seat or a dealt-in player. (Regression: a phantom "worker-relay" was being seated.)
  const log: ReducerEvent[] = [
    newRound(1, ['A', 'B']),
    { type: 'action/bet', from: 'worker-relay', round: 1, amount: 5 },
  ];
  const s = reduceTexasHoldem(log, new Map(), ['A', 'B', 'worker-relay']);
  expect(s.seatPlayers.some(p => p.peerId === 'worker-relay')).toBe(false);
  expect(s.seatedForNextHand).not.toContain('worker-relay');
  expect(s.knownPeers.has('worker-relay')).toBe(false);
  expect(s.seatedForNextHand.sort()).toEqual(['A', 'B']);
});

test('a player who stays gone after the hand is not falsely seated', () => {
  const s = reduceTexasHoldem([newRound(1, ['A', 'B']), handResult(1, 'B')], new Map(), ['B']);
  expect(statusOf(s, 'A')).toBe('offline');
  expect(s.seatedForNextHand).toEqual(['B']);
  expect(s.playable).toBe(false);
});
