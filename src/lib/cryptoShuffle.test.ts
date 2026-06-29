import {EncodedDeck} from "./secureMentalPoker";
import {secureRandomIntBelow, secureShuffleEncodedDeck} from "./cryptoShuffle";

describe('secureRandomIntBelow', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('uses crypto.getRandomValues instead of Math.random', () => {
    const mathRandomSpy = jest.spyOn(Math, 'random');
    const getRandomValues = jest.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((buffer) => {
      const sample = buffer as Uint32Array;
      sample[0] = 7;
      return buffer;
    });

    expect(secureRandomIntBelow(5)).toBe(2);
    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(mathRandomSpy).not.toHaveBeenCalled();
  });

  test('rejects modulo-biased samples', () => {
    const getRandomValues = jest.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((buffer) => {
      const sample = buffer as Uint32Array;
      sample[0] = getRandomValues.mock.calls.length === 1 ? 0xffffffff : 8;
      return buffer;
    });

    expect(secureRandomIntBelow(10)).toBe(8);
    expect(getRandomValues).toHaveBeenCalledTimes(2);
  });
});

describe('secureShuffleEncodedDeck', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('performs Fisher-Yates with a fresh secure draw for each swap', () => {
    const draws = [0, 1, 1];
    const getRandomValues = jest.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((buffer) => {
      const sample = buffer as Uint32Array;
      sample[0] = draws.shift() ?? 0;
      return buffer;
    });

    const deck = new EncodedDeck([BigInt(1), BigInt(2), BigInt(3), BigInt(4)]);
    secureShuffleEncodedDeck(deck);

    expect(deck.cards).toEqual([BigInt(4), BigInt(3), BigInt(2), BigInt(1)]);
    expect(getRandomValues).toHaveBeenCalledTimes(3);
  });
});
