import {
  validateMentalPokerEvent,
  isMentalPokerEventType,
  isIntegerString,
  isEncodedDeck,
  STANDARD_DECK_SIZE,
  MAX_INTEGER_STRING_LENGTH,
} from "./mentalPokerSchema";

const deck = () => Array.from({length: STANDARD_DECK_SIZE}, (_, i) => String(i + 1));

describe('isIntegerString', () => {
  it('accepts canonical decimal big-integer strings', () => {
    expect(isIntegerString('0')).toBe(true);
    expect(isIntegerString('123456789012345678901234567890')).toBe(true);
    expect(isIntegerString('-7')).toBe(true);
  });

  it('rejects non-integer / unsafe strings', () => {
    expect(isIntegerString('')).toBe(false);
    expect(isIntegerString('-')).toBe(false);
    expect(isIntegerString('12.3')).toBe(false);
    expect(isIntegerString('0x1f')).toBe(false);
    expect(isIntegerString('abc')).toBe(false);
    expect(isIntegerString(123 as unknown)).toBe(false);
    expect(isIntegerString('1'.repeat(MAX_INTEGER_STRING_LENGTH + 1))).toBe(false);
  });
});

describe('isEncodedDeck', () => {
  it('accepts exactly 52 integer strings', () => {
    expect(isEncodedDeck(deck())).toBe(true);
  });
  it('rejects wrong length or non-integer entries', () => {
    expect(isEncodedDeck(deck().slice(0, 51))).toBe(false);
    expect(isEncodedDeck([...deck().slice(0, 51), 'x'])).toBe(false);
    expect(isEncodedDeck('not-an-array')).toBe(false);
  });
});

describe('isMentalPokerEventType', () => {
  it('recognizes only mental-poker types', () => {
    expect(isMentalPokerEventType('deck/shuffle')).toBe(true);
    expect(isMentalPokerEventType('card/decrypt')).toBe(true);
    expect(isMentalPokerEventType('newRound')).toBe(false);
    expect(isMentalPokerEventType('action/bet')).toBe(false);
    expect(isMentalPokerEventType(undefined)).toBe(false);
  });
});

describe('validateMentalPokerEvent', () => {
  it('accepts a well-formed deck/shuffle with public key', () => {
    expect(validateMentalPokerEvent({
      type: 'deck/shuffle',
      round: 1,
      player: 'alice',
      shuffleIndex: 0,
      deck: deck(),
      publicKey: {p: '23', q: '29'},
    }).ok).toBe(true);
  });

  it('accepts deck/lock, deck/finalized, start and card/decrypt', () => {
    expect(validateMentalPokerEvent({type: 'deck/lock', round: 1, player: 'a', lockIndex: 0, deck: deck()}).ok).toBe(true);
    expect(validateMentalPokerEvent({type: 'deck/finalized', round: 1, player: 'a', deck: deck()}).ok).toBe(true);
    expect(validateMentalPokerEvent({type: 'start', round: 1, mentalPokerSettings: {alice: 'a', bob: 'b'}}).ok).toBe(true);
    expect(validateMentalPokerEvent({type: 'card/decrypt', round: 1, cardOffset: 5, decryptionKey: {d: '3', n: '33'}}).ok).toBe(true);
    // sealed (end-to-end) private card key is also valid; neither present is not.
    expect(validateMentalPokerEvent({type: 'card/decrypt', round: 1, cardOffset: 5, sealedKey: 'AbC123'}).ok).toBe(true);
    expect(validateMentalPokerEvent({type: 'card/decrypt', round: 1, cardOffset: 5}).ok).toBe(false);
    expect(validateMentalPokerEvent({type: 'identity/encryptionKey', publicKeyJwk: {kty: 'RSA'}}).ok).toBe(true);
    expect(validateMentalPokerEvent({type: 'identity/encryptionKey'}).ok).toBe(false);
  });

  it('rejects a deck that is not 52 integer strings', () => {
    expect(validateMentalPokerEvent({type: 'deck/shuffle', round: 1, player: 'a', shuffleIndex: 0, deck: deck().slice(0, 10)}).ok).toBe(false);
    expect(validateMentalPokerEvent({type: 'deck/finalized', round: 1, player: 'a', deck: [...deck().slice(0, 51), 'NaN']}).ok).toBe(false);
  });

  it('rejects malformed decryption keys (DoS / BigInt-throw vectors)', () => {
    expect(validateMentalPokerEvent({type: 'card/decrypt', round: 1, cardOffset: 5, decryptionKey: {d: 'abc', n: '33'}}).ok).toBe(false);
    expect(validateMentalPokerEvent({type: 'card/decrypt', round: 1, cardOffset: 5, decryptionKey: {d: '3'}}).ok).toBe(false);
    expect(validateMentalPokerEvent({type: 'card/decrypt', round: 1, cardOffset: 99, decryptionKey: {d: '3', n: '33'}}).ok).toBe(false);
  });

  it('rejects a malformed public key', () => {
    expect(validateMentalPokerEvent({
      type: 'deck/shuffle', round: 1, player: 'a', shuffleIndex: 0, deck: deck(),
      publicKey: {p: 'x', q: '29'},
    }).ok).toBe(false);
  });
});
