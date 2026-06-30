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

test('deal-phase cannotContinue (deck never finalized — mid-shuffle refresh) VOIDS and refunds the blinds', () => {
  // The encrypted shuffle was interrupted (e.g. a page refresh mid-shuffle): no deck/finalized
  // ever lands, so the deck can never become ready and no hole card can be dealt. A
  // cannotContinue in this deal phase must VOID the hand and refund the forced blinds — never
  // fold someone — so neither side wins or loses chips over a broken deal and the table can
  // re-deal cleanly. Both players are still connected.
  const state = reduceTexasHoldem(
    [newRound, { type: 'action/cannotContinue', from: 'p2', round: 1 }],
    new Map(),
    ['p1', 'p2'],
  );
  const round = state.rounds.get(1)!;
  expect(round.result?.how).toBe('Voided');
  // Blinds (SB 1, BB 2) fully refunded → both back to the bought-in 100.
  expect(state.funds.get('p1')).toBe(100);
  expect(state.funds.get('p2')).toBe(100);
});

test('post-deal cannotContinue (deck finalized) is the V8 anti-dodge FOLD, not a void', () => {
  // Once deck/finalized lands the deck is ready and hole cards exist, so a fully-connected
  // cannotContinue is a dodge attempt — it must fold the declarer (so the loss can stand),
  // exactly as before this fix. Voiding here would let a player claw back a dealt hand.
  const state = reduceTexasHoldem(
    [
      newRound,
      { type: 'deck/finalized', from: 'p1', round: 1 },
      { type: 'action/cannotContinue', from: 'p2', round: 1 },
    ],
    new Map(),
    ['p1', 'p2'],
  );
  const round = state.rounds.get(1)!;
  expect(round.result?.how).not.toBe('Voided');
  expect(round.folded.has('p2')).toBe(true);
  // p2 folded → p1 takes the pot (the loss stands, no claw-back).
  expect(round.result?.how).toBe('LastOneWins');
});
