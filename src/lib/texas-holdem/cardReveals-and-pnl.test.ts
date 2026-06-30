// Unit coverage for the two helpers behind the funds fix:
//  - cardRevealsFromHands: board/hole → reducer offset map (board 0..4, player i at 2i+5/6).
//  - reducer boughtIn: session P&L (funds − boughtIn) is balanced and replay-stable.

import { cardRevealsFromHands, reduceTexasHoldem, ReducerEvent } from "./texasHoldemReducer";
import { StandardCard } from "../secureMentalPoker";

const C = (rank: string, suit: string): StandardCard => ({ rank, suit } as StandardCard);

test('cardRevealsFromHands maps board and holes to the reducer offsets', () => {
  const reveals = cardRevealsFromHands([
    {
      round: 1,
      players: ['A', 'B'],
      board: [C('2', 'Spades'), C('7', 'Hearts'), C('K', 'Diamonds'), C('9', 'Clubs'), C('A', 'Spades')],
      holesPerPlayer: new Map([
        ['A', [C('Q', 'Hearts'), C('Q', 'Spades')]],
        ['B', [C('3', 'Clubs'), C('4', 'Clubs')]],
      ]),
    },
  ]);
  const m = reveals.get(1)!;
  // board 0..4
  expect(m.get(0)).toEqual(C('2', 'Spades'));
  expect(m.get(4)).toEqual(C('A', 'Spades'));
  // player 0 (A) holes at 5,6 ; player 1 (B) holes at 7,8
  expect(m.get(5)).toEqual(C('Q', 'Hearts'));
  expect(m.get(6)).toEqual(C('Q', 'Spades'));
  expect(m.get(7)).toEqual(C('3', 'Clubs'));
  expect(m.get(8)).toEqual(C('4', 'Clubs'));
});

test('cardRevealsFromHands skips fold-out hands with no holes (no spurious reveals)', () => {
  const reveals = cardRevealsFromHands([{ round: 2, players: ['A', 'B'], board: [], holesPerPlayer: undefined }]);
  expect(reveals.get(2)).toBeUndefined();
});

test('reducer session P&L (funds − boughtIn) is balanced and ignores illegal bets', () => {
  const settings = { initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2 };
  const log: ReducerEvent[] = [
    { type: 'newRound', from: 'A', round: 1, players: ['A', 'B'], settings },
    { type: 'action/bet', from: 'B', round: 1, amount: 999999 }, // illegal: ignored
    { type: 'action/bet', from: 'A', round: 1, amount: 1 },      // SB completes → both in for 2
    { type: 'action/fold', from: 'B', round: 1 },                // B folds → A wins the pot
  ];
  const s = reduceTexasHoldem(log, new Map(), ['A', 'B']);
  let netSum = 0;
  for (const p of ['A', 'B']) {
    const net = (s.funds.get(p) ?? 0) - (s.boughtIn.get(p) ?? 0);
    netSum += net;
  }
  // Every chip came from a buy-in and never left the table → the P&L always sums to zero.
  expect(netSum).toBe(0);
  // Both put in $2; A wins the pot, so A is +2 and B is −2: a small, balanced, sane delta —
  // never an unbalanced -$200.
  expect((s.funds.get('A') ?? 0) - (s.boughtIn.get('A') ?? 0)).toBe(2);
  expect((s.funds.get('B') ?? 0) - (s.boughtIn.get('B') ?? 0)).toBe(-2);
});

test('a LEGITIMATELY voided hand (disconnect + cannotContinue) refunds every committed chip', () => {
  const settings = { initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2 };
  // Heads-up: A=SB posts 1, B=BB posts 2, A completes to 2 → both committed 2. Then B drops
  // (unreachable) and A declares the hand unfinishable (cannotContinue). That objective,
  // signed evidence is what voids the hand — not a bare result — and every chip comes back.
  const log: ReducerEvent[] = [
    { type: 'newRound', from: 'A', round: 1, players: ['A', 'B'], settings },
    { type: 'action/bet', from: 'A', round: 1, amount: 1 },        // SB completes to 2
    { type: 'action/cannotContinue', from: 'A', round: 1 },        // declared unfinishable
  ];
  const s = reduceTexasHoldem(log, new Map(), ['A']);             // B is unreachable → legit void
  // Refunded to the start-of-hand stacks; nothing lost.
  expect(s.funds.get('A')).toBe(100);
  expect(s.funds.get('B')).toBe(100);
  // Conserved + balanced (no chips stuck in a voided pot).
  const fundsTotal = Array.from(s.funds.values()).reduce((a, b) => a + b, 0);
  const boughtInTotal = Array.from(s.boughtIn.values()).reduce((a, b) => a + b, 0);
  expect(fundsTotal).toBe(boughtInTotal);
  expect(s.rounds.get(1)?.result?.how).toBe('Voided');
});

test('E-1: a bare hand/result can NOT void a live hand or claw back committed chips', () => {
  const settings = { initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2 };
  // Both players fully connected (no disconnect, no unanimous void vote, no cannotContinue).
  // A — about to be on the hook for 2 chips — forges a bare `hand/result` to try to "void" the
  // hand and refund the pot. Post E-1 the reducer ignores it: the hand stays live, no refund.
  const log: ReducerEvent[] = [
    { type: 'newRound', from: 'A', round: 1, players: ['A', 'B'], settings },
    { type: 'action/bet', from: 'A', round: 1, amount: 1 }, // SB completes to 2
    { type: 'hand/result', from: 'A', round: 1 },           // forged "void & refund" attempt
  ];
  const s = reduceTexasHoldem(log, new Map(), ['A', 'B']);
  // No refund: both committed 2 (funds 98 each), pot intact, hand NOT voided/resolved.
  expect(s.funds.get('A')).toBe(98);
  expect(s.funds.get('B')).toBe(98);
  expect(s.rounds.get(1)?.result).toBeUndefined();
});
