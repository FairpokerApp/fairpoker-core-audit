// Seating/lifecycle view of the unified reducer — the browser-authoritative replacement
// for the Worker's roomState. Asserts the live semantics: lobby seats everyone reachable,
// a mid-hand disconnect is transient 'missing' (rejoins on reconnect, no sticky lock-out),
// sit-out/return toggles the seat, and a finished hand re-seats everyone for the next hand
// (the livelock fix). (BROWSER_AUTHORITATIVE_REWORK_PLAN.md S3.)

import { reduceTexasHoldem, ReducerEvent } from "./texasHoldemReducer";

const settings = { initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2 };
const newRound = (round: number, players: string[]): ReducerEvent =>
  ({ type: 'newRound', from: players[0], round, players, settings });
// A hand really ends when a player folds (or a showdown resolves) — a bare `hand/result` is
// only an informational "hand over" ping and (post E-1) never resolves/voids a hand, so these
// seating tests end the hand the way real play does: with a fold.
const fold = (round: number, from: string): ReducerEvent => ({ type: 'action/fold', from, round });
const sitOut = (from: string): ReducerEvent => ({ type: 'action/sitOut', from });
const returnToTable = (from: string): ReducerEvent => ({ type: 'action/returnToTable', from });
const takeSeat = (from: string, seat: number): ReducerEvent => ({ type: 'action/takeSeat', from, seat });

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
  const log = [newRound(1, ['A', 'B']), returnToTable('A'), fold(1, 'A')];
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

test('a standard table seats at most 9 (MAX_SEATS); extra peers spectate ("watching")', () => {
  // Twelve reachable peers want to play. A 9-max table seats exactly 9; the rest stay
  // as spectators until a seat frees up. The kept 9 are taken in a deterministic
  // (sorted peerId) order so every client agrees on the same nine.
  const peers = ['P01','P02','P03','P04','P05','P06','P07','P08','P09','P10','P11','P12'];
  const s = reduceTexasHoldem([], new Map(), peers);
  expect(s.seatedForNextHand.length).toBe(9);
  expect(s.seatedForNextHand).toEqual(['P01','P02','P03','P04','P05','P06','P07','P08','P09']);
  expect(statusOf(s, 'P10')).toBe('watching');
  expect(statusOf(s, 'P12')).toBe('watching');
  expect(s.playable).toBe(true);
});

test('exactly 9 reachable peers all keep a seat (the cap does not under-seat)', () => {
  const peers = ['A','B','C','D','E','F','G','H','I'];
  const s = reduceTexasHoldem([], new Map(), peers);
  expect(s.seatedForNextHand.length).toBe(9);
  expect(s.seatedForNextHand.sort()).toEqual(peers);
});

test('seats: everyone at the table gets a distinct, stable absolute seat (real-poker fixed seats)', () => {
  const s = reduceTexasHoldem([], new Map(), ['A', 'B', 'C']);
  const seats = ['A', 'B', 'C'].map(p => s.seatByPeer.get(p));
  expect(seats.every(v => typeof v === 'number')).toBe(true);
  expect(new Set(seats).size).toBe(3); // distinct chairs
});

test('seats: a player keeps the SAME chair when others join or leave (no reshuffle)', () => {
  // Real-poker discipline: a vacated chair stays empty, nobody slides over, and a new
  // arrival never bumps an existing player out of their chair.
  const two = reduceTexasHoldem([], new Map(), ['A', 'B']);
  const seatA = two.seatByPeer.get('A');
  const seatB = two.seatByPeer.get('B');
  const three = reduceTexasHoldem([], new Map(), ['A', 'B', 'C']);
  expect(three.seatByPeer.get('A')).toBe(seatA); // C joining moves nobody
  expect(three.seatByPeer.get('B')).toBe(seatB);
  const backToTwo = reduceTexasHoldem([], new Map(), ['A', 'B']);
  expect(backToTwo.seatByPeer.get('A')).toBe(seatA); // C leaving moves nobody
  expect(backToTwo.seatByPeer.get('B')).toBe(seatB);
});

test('seats: a mid-hand spectator never bumps a dealt-in player off their chair (collision-safe)', () => {
  // 'A' and 'J' hash to the same starting chair and 'A' sorts first. If the late-arriving
  // spectator 'A' were placed before the dealt-in 'J', it would shove 'J' to another seat
  // mid-deal. A dealt-in seat is locked for the whole hand — 'J' must keep its chair.
  const log = [newRound(1, ['J', 'B'])];
  const before = reduceTexasHoldem(log, new Map(), ['J', 'B']);
  const seatJ = before.seatByPeer.get('J');
  const seatB = before.seatByPeer.get('B');
  const withSpectator = reduceTexasHoldem(log, new Map(), ['J', 'B', 'A']);
  expect(withSpectator.seatByPeer.get('J')).toBe(seatJ);
  expect(withSpectator.seatByPeer.get('B')).toBe(seatB);
  expect(withSpectator.seatByPeer.get('A')).not.toBe(seatJ); // the latecomer gets its own chair
});

test('seats: an explicit takeSeat between hands is honoured exactly (click A ⇒ sit A)', () => {
  const s = reduceTexasHoldem([takeSeat('B', 7)], new Map(), ['A', 'B', 'C']);
  expect(s.seatByPeer.get('B')).toBe(7);
  expect(s.seatByPeer.get('A')).not.toBe(7);
  expect(s.seatByPeer.get('C')).not.toBe(7);
});

test('seats: a seat change is LOCKED during a live hand (ignored, not queued)', () => {
  // B tries to move while a hand is live → the request is dropped, so the table never
  // reshuffles mid-deal.
  const mid = reduceTexasHoldem([newRound(1, ['A', 'B']), takeSeat('B', 7)], new Map(), ['A', 'B']);
  expect(mid.seatChoices.has('B')).toBe(false);
  // Once the hand ends, the same between-hands request IS honoured exactly.
  const between = reduceTexasHoldem(
    [newRound(1, ['A', 'B']), fold(1, 'A'), takeSeat('B', 7)], new Map(), ['A', 'B'],
  );
  expect(between.seatByPeer.get('B')).toBe(7);
});

test('seats: a seat held by a PRESENT player cannot be taken (first chooser keeps it)', () => {
  const s = reduceTexasHoldem([takeSeat('B', 4), takeSeat('A', 4)], new Map(), ['A', 'B', 'C']);
  expect(s.seatByPeer.get('B')).toBe(4); // B chose 4 first
  expect(s.seatByPeer.get('A')).not.toBe(4); // A's collision is ignored
});

test("seats: a departed player's stale reservation does not block a present player", () => {
  // Z claimed seat 5 then left (not connected). A, who is present, can still take seat 5 —
  // a ghost reservation must never lock a chair forever.
  const s = reduceTexasHoldem([takeSeat('Z', 5), takeSeat('A', 5)], new Map(), ['A', 'B']);
  expect(s.seatByPeer.get('A')).toBe(5);
});

test('seats: an out-of-range seat choice is ignored', () => {
  const s = reduceTexasHoldem([takeSeat('B', 99)], new Map(), ['A', 'B']);
  expect(s.seatByPeer.get('B')).toBeLessThan(9);
  expect(s.seatByPeer.get('B')).toBeGreaterThanOrEqual(0);
});

test('a player who stays gone after the hand is not falsely seated', () => {
  const s = reduceTexasHoldem([newRound(1, ['A', 'B']), fold(1, 'A')], new Map(), ['B']);
  expect(statusOf(s, 'A')).toBe('offline');
  expect(s.seatedForNextHand).toEqual(['B']);
  expect(s.playable).toBe(false);
});
