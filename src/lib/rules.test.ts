import {calculateEffectiveCardOffsets, evaluateStandardCards} from "./rules";
import {StandardCard} from "./secureMentalPoker";

const royalFlush: StandardCard[] = [
  {suit: 'Diamond', rank: 'A'},
  {suit: 'Diamond', rank: 'K'},
  {suit: 'Diamond', rank: 'Q'},
  {suit: 'Diamond', rank: 'J'},
  {suit: 'Diamond', rank: 'T'},
];

test('calculateEffectiveCardOffsets', () => {
  const strengthOfFullHouse = evaluateStandardCards([
    {suit: 'Heart', rank: '2'},
    {suit: 'Club', rank: 'A'},
    {suit: 'Heart', rank: 'A'},
    {suit: 'Spade', rank: 'A'},
    {suit: 'Spade', rank: '2'},
  ]);
  const effectiveCards = calculateEffectiveCardOffsets([
    {suit: 'Heart', rank: '2'},
    {suit: 'Club', rank: 'A'},
    {suit: 'Heart', rank: 'A'},
    {suit: 'Club', rank: '3'},
    {suit: 'Heart', rank: '8'},
    {suit: 'Spade', rank: 'A'},
    {suit: 'Spade', rank: '2'},
  ], strengthOfFullHouse);

  expect(effectiveCards).toEqual([0, 1, 2, 5, 6]);
});

test('calculateEffectiveCardOffsets without nonexistent strength', () => {
  const evaluate = () => 1;
  const effectiveCards = calculateEffectiveCardOffsets([
    {suit: 'Heart', rank: '2'},
    {suit: 'Club', rank: 'A'},
    {suit: 'Heart', rank: 'A'},
    {suit: 'Club', rank: '3'},
    {suit: 'Heart', rank: '8'},
    {suit: 'Spade', rank: 'A'},
    {suit: 'Spade', rank: '2'},
  ], 2, evaluate);

  expect(effectiveCards).toBeNull();
});

test('calculateEffectiveCardOffsets with exactly five cards', () => {
  const strength = evaluateStandardCards(royalFlush);
  expect(calculateEffectiveCardOffsets(royalFlush, strength)).toEqual([0, 1, 2, 3, 4]);
});

test('calculateEffectiveCardOffsets does not evaluate partial hands', () => {
  const evaluate = jest.fn(() => 1);
  expect(calculateEffectiveCardOffsets(royalFlush.slice(0, 2), 1, evaluate)).toBeNull();
  expect(evaluate).not.toHaveBeenCalled();
});
