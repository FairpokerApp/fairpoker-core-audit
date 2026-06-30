import {decodeStandardCard, isEncodedStandardCard, isStandardCard} from './secureMentalPoker';

test('only the (index+1)^2 card encodings are standard encoded cards', () => {
  // Cards are encoded as (cardIndex+1)^2 (perfect squares 4,9,16,...,2809): still all quadratic
  // residues (the QR fingerprint leaks nothing, Audit V1), but shifted off the 0/1 fixed points so
  // no card's ciphertext is ever trivially "1". (Audit R4-11.)
  expect(isEncodedStandardCard(4)).toBe(true);     // 2^2  (index 1 — Heart A)
  expect(isEncodedStandardCard(9)).toBe(true);     // 3^2  (index 2)
  expect(isEncodedStandardCard(2809)).toBe(true);  // 53^2 (index 52 — last card)
  expect(isEncodedStandardCard(1)).toBe(false);    // 1 is the FIXED POINT — no longer a valid card
  expect(isEncodedStandardCard(2)).toBe(false);    // not a perfect square
  expect(isEncodedStandardCard(52)).toBe(false);   // not a perfect square
  expect(isEncodedStandardCard(2810)).toBe(false); // beyond 53^2
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
