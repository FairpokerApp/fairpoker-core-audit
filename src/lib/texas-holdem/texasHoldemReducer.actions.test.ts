// Per-seat bet-chip view (S2-rest): reducedActionsByPlayer derives each seat's CURRENT
// street bet (or fold/all-in/check) purely from the log, so the chips converge across
// clients instead of "vanishing" on a reconnected one.

import { reduceTexasHoldem, reducedActionsByPlayer, ReducerEvent } from "./texasHoldemReducer";

const settings = { initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2 };
const newRound: ReducerEvent = { type: 'newRound', from: 'p1', round: 1, players: ['p1', 'p2'], settings };
const reducedRound1 = (log: ReducerEvent[]) =>
  reduceTexasHoldem(log, new Map(), ['p1', 'p2']).rounds.get(1)!;

test('blinds show as the preflop bet chips', () => {
  const a = reducedActionsByPlayer(reducedRound1([newRound]));
  expect(a.get('p1')).toBe(1); // small blind
  expect(a.get('p2')).toBe(2); // big blind
});

test('a raise shows its amount; an all-in shows the "all-in" label', () => {
  // p1 (SB, fund 99 after the blind) shoves the rest → all-in; p2 has only its BB in.
  const a = reducedActionsByPlayer(reducedRound1([
    newRound,
    { type: 'action/bet', from: 'p1', round: 1, amount: 99 },
  ]));
  expect(a.get('p1')).toBe('all-in');
  expect(a.get('p2')).toBe(2);
});

test('a folded player shows the "fold" label', () => {
  const a = reducedActionsByPlayer(reducedRound1([
    newRound,
    { type: 'action/bet', from: 'p1', round: 1, amount: 99 }, // all-in
    { type: 'action/fold', from: 'p2', round: 1 },
  ]));
  expect(a.get('p2')).toBe('fold');
  expect(a.get('p1')).toBe('all-in');
});

test('chips reset to nothing when a new street begins (per-street, not cumulative)', () => {
  // Preflop completes (SB calls to 2, BB checks) → flop begins → no street bets yet.
  const a = reducedActionsByPlayer(reducedRound1([
    newRound,
    { type: 'action/bet', from: 'p1', round: 1, amount: 1 }, // SB completes to 2 (call)
    { type: 'action/bet', from: 'p2', round: 1, amount: 0 }, // BB checks → street closes
  ]));
  // On the flop, neither player has a current-street bet chip.
  expect(a.has('p1')).toBe(false);
  expect(a.has('p2')).toBe(false);
});
