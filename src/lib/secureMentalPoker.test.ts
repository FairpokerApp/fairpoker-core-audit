import {decodeStandardCard, isEncodedStandardCard, isStandardCard} from './secureMentalPoker';

test('only the squared 1..52 card encodings are standard encoded cards', () => {
  // Cards are now encoded as cardIndex^2 (perfect squares 1,4,9,...,2704) so every
  // card is a quadratic residue and the QR fingerprint leaks nothing. (Audit V1.)
  expect(isEncodedStandardCard(1)).toBe(true);     // 1^2
  expect(isEncodedStandardCard(4)).toBe(true);     // 2^2
  expect(isEncodedStandardCard(2704)).toBe(true);  // 52^2
  expect(isEncodedStandardCard(2)).toBe(false);    // not a perfect square
  expect(isEncodedStandardCard(52)).toBe(false);   // not a perfect square
  expect(isEncodedStandardCard(2705)).toBe(false); // beyond 52^2
  expect(isEncodedStandardCard(0)).toBe(false);
  expect(isEncodedStandardCard(53)).toBe(false);
  expect(isEncodedStandardCard(1.8916318659736983e+153)).toBe(false);
});

test('decodeStandardCard rejects encrypted-size numbers', () => {
  expect(() => decodeStandardCard(1.8916318659736983e+153)).toThrow('Invalid encoded card');
});

test('isStandardCard accepts only standard card-shaped objects', () => {
  expect(isStandardCard({suit: 'Club', rank: 'A'})).toBe(true);
  expect(isStandardCard(1.8916318659736983e+153)).toBe(false);
  expect(isStandardCard({suit: 'Encrypted', rank: 'A'})).toBe(false);
});
