import {EncodedDeck, Player} from "./secureMentalPoker";

const UINT32_RANGE = 0x100000000;

function getCrypto(): Crypto {
  const cryptoApi = globalThis.crypto
    ?? (typeof window !== 'undefined' ? window.crypto : undefined);

  if (!cryptoApi?.getRandomValues) {
    throw new Error('Secure random source is unavailable.');
  }

  return cryptoApi;
}

export function secureRandomIntBelow(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > UINT32_RANGE) {
    throw new Error(`Invalid random upper bound: ${maxExclusive}`);
  }

  const limit = Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive;
  const sample = new Uint32Array(1);
  const cryptoApi = getCrypto();

  while (true) {
    cryptoApi.getRandomValues(sample);
    if (sample[0] < limit) {
      return sample[0] % maxExclusive;
    }
  }
}

export function secureShuffleEncodedDeck(deck: EncodedDeck): EncodedDeck {
  for (let i = deck.cards.length - 1; i > 0; i -= 1) {
    const j = secureRandomIntBelow(i + 1);
    if (i !== j) {
      const card = deck.cards[i];
      deck.cards[i] = deck.cards[j];
      deck.cards[j] = card;
    }
  }
  return deck;
}

export function encryptAndSecureShuffle(player: Player, deck: EncodedDeck): EncodedDeck {
  const mainSraKey = (player as unknown as { mainSraKey: unknown }).mainSraKey;
  if (!mainSraKey) {
    throw new Error('Mental poker player main key is unavailable.');
  }

  const encryptedDeck = deck.encrypt(mainSraKey as Parameters<EncodedDeck['encrypt']>[0]);
  return secureShuffleEncodedDeck(encryptedDeck);
}
