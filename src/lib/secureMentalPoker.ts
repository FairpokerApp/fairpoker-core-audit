import {
  DecryptionKey,
  generateShamirRivestAdleman,
  PublicKey,
  ShamirRivestAdleman,
} from 'mental-poker-toolkit/build/main/lib/sra';

export { DecryptionKey, PublicKey };

export type Suit = 'Heart' | 'Diamond' | 'Club' | 'Spade';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K';

export interface StandardCard {
  suit: Suit;
  rank: Rank;
}

export type StandardDeck = StandardCard[];

const SUITS: Suit[] = ['Heart', 'Diamond', 'Club', 'Spade'];
const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];

export const DEFAULT_MENTAL_POKER_BITS = 1024;
// Security floor for the mental-poker SRA prime size. Every participant necessarily
// learns the shared modulus' factorization (it is required to derive a co-modulus
// key), so card secrecy rests on the hardness of DISCRETE LOGS in the prime field,
// not on factoring. Prime-field DLP at 256/512/768 bits is within reach of a
// motivated attacker (the public DLP record is ~795-bit), so the floor is 1024-bit
// primes (a 2048-bit modulus), where per-hand fresh-prime DLP is infeasible.
// (Audit V2; supersedes the old 256-bit floor.)
export const MIN_MENTAL_POKER_BITS = 1024;
// Hard ceiling: a forged `start` requesting an enormous bit size can no longer make
// every client hang generating gigantic primes. (Audit V10 DoS.)
export const MAX_MENTAL_POKER_BITS = 2048;

export function normalizeMentalPokerBits(bits?: number): number {
  const requestedBits = bits ?? DEFAULT_MENTAL_POKER_BITS;
  if (!Number.isInteger(requestedBits)) {
    throw new Error(`Mental poker SRA bits must be an integer, got ${requestedBits}`);
  }
  // Clamp into [MIN, MAX]: an older or misconfigured table requesting tiny bits is
  // transparently upgraded to the floor (no crash), and a malicious `start`
  // requesting a huge size is capped instead of hanging every client.
  // (Audit C02 weak params; E02/V10 malformed-input DoS.)
  return Math.min(MAX_MENTAL_POKER_BITS, Math.max(MIN_MENTAL_POKER_BITS, requestedBits));
}

export function getStandard52Deck(): StandardDeck {
  const standardDeck: StandardDeck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      standardDeck.push({ suit, rank });
    }
  }
  return standardDeck;
}

// The 1..52 ordinal of a card. Kept internal; the wire encoding squares it.
export function cardIndexOf(card: StandardCard): number {
  const suitIndex = SUITS.indexOf(card.suit);
  const rankIndex = RANKS.indexOf(card.rank);
  if (suitIndex < 0 || rankIndex < 0) {
    throw new Error(`Invalid standard card: ${card.suit} ${card.rank}`);
  }
  return suitIndex * RANKS.length + rankIndex + 1; // 1..52
}

// Cards are encoded as PERFECT SQUARES (cardIndex^2, so 1,4,9,...,2704). A perfect
// square is a quadratic residue mod every prime, so every card shares the SAME
// (QR mod p, QR mod q) fingerprint. SRA encryption (raising to an odd power)
// preserves that fingerprint, and every participant knows p,q — so the old plain
// 1..52 encoding leaked ~2 bits about every hidden card (incl. folded hole cards)
// to anyone, with zero keys. Squaring makes all 52 fingerprints identical, closing
// the leak. (Audit V1.)
export function encodeStandardCard(card: StandardCard): number {
  const index = cardIndexOf(card);
  return index * index;
}

export function isEncodedStandardCard(n: number): boolean {
  if (!Number.isInteger(n) || n < 1 || n > 52 * 52) {
    return false;
  }
  const index = Math.round(Math.sqrt(n));
  return index >= 1 && index <= 52 && index * index === n;
}

export function isStandardCard(value: unknown): value is StandardCard {
  const card = value as StandardCard | undefined;
  return Boolean(
    card
    && typeof card === 'object'
    && SUITS.includes(card.suit)
    && RANKS.includes(card.rank)
  );
}

export function decodeStandardCard(n: number): StandardCard {
  if (!isEncodedStandardCard(n)) {
    throw new Error(`Invalid encoded card: ${n}`);
  }
  const zeroBased = Math.round(Math.sqrt(n)) - 1; // recover cardIndex (1..52), then 0-based
  return {
    suit: SUITS[Math.floor(zeroBased / RANKS.length)],
    rank: RANKS[zeroBased % RANKS.length],
  };
}

export class EncodedDeck {
  readonly cards: bigint[];

  constructor(cards: bigint[]) {
    this.cards = cards;
  }

  encrypt(sra: ShamirRivestAdleman): EncodedDeck {
    return new EncodedDeck(this.cards.map((card) => sra.encryptionKey.encrypt(card)));
  }

  encryptIndividually(sra: ShamirRivestAdleman[]): EncodedDeck {
    return new EncodedDeck(this.cards.map((card, i) => sra[i].encryptionKey.encrypt(card)));
  }

  decrypt(sra: ShamirRivestAdleman): EncodedDeck {
    return new EncodedDeck(this.cards.map((card) => sra.decryptionKey.decrypt(card)));
  }
}

export class Player {
  readonly mainSraKey: ShamirRivestAdleman;
  readonly individualSraKeys: ShamirRivestAdleman[];

  constructor(props: {
    mainSraKey: ShamirRivestAdleman;
    individualSraKeys: ShamirRivestAdleman[];
  }) {
    this.mainSraKey = props.mainSraKey;
    this.individualSraKeys = props.individualSraKeys;
  }

  decryptAndEncryptIndividually(deckDoubleEncrypted: EncodedDeck): EncodedDeck {
    const deckSingleEncrypted = deckDoubleEncrypted.decrypt(this.mainSraKey);
    return deckSingleEncrypted.encryptIndividually(this.individualSraKeys);
  }

  getIndividualKey(offset: number): ShamirRivestAdleman {
    return this.individualSraKeys[offset];
  }

  get publicKey(): PublicKey {
    return this.mainSraKey.publicKey;
  }
}

function secureCrypto(): Crypto {
  const cryptoApi = globalThis.crypto
    ?? (typeof window !== 'undefined' ? window.crypto : undefined);
  if (!cryptoApi?.getRandomValues) {
    throw new Error('Secure random source is unavailable.');
  }
  return cryptoApi;
}

// BigInt() calls (not 1n/0n literals) and index loops (not for-of over a typed
// array) keep this compiling under the project's pre-ES2020 TS target.
const BIG_ZERO = BigInt(0);
const BIG_ONE = BigInt(1);
const BIG_EIGHT = BigInt(8);

function randomOddBigIntOfBits(bits: number): bigint {
  const byteLength = Math.ceil(bits / 8);
  const buffer = new Uint8Array(byteLength);
  secureCrypto().getRandomValues(buffer);
  let value = BIG_ZERO;
  for (let i = 0; i < buffer.length; i += 1) {
    value = (value << BIG_EIGHT) | BigInt(buffer[i]);
  }
  value >>= BigInt(byteLength * 8 - bits); // trim to exactly `bits` bits
  value |= BIG_ONE << BigInt(bits - 1);     // force the full bit-length
  value |= BIG_ONE;                          // force odd
  return value;
}

function bigIntGcd(a: bigint, b: bigint): bigint {
  let x = a < BIG_ZERO ? -a : a;
  let y = b < BIG_ZERO ? -b : b;
  while (y !== BIG_ZERO) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }
  return x;
}

// Draws an SRA encryption exponent e coprime to phi as a random odd `bits`-bit
// integer instead of a fresh prime. SRA only requires gcd(e, phi)=1 (so the
// decryption key d = e^-1 mod phi exists); a random coprime exponent is just as
// sound and skips ~50 expensive primality searches per player, which is what keeps
// the larger 1024-bit modulus fast enough to stay playable. (Audit V2 performance.)
function generateCoprimeExponent(publicKey: PublicKey, bits: number): bigint {
  const phi = (publicKey.p - BIG_ONE) * (publicKey.q - BIG_ONE);
  for (let attempt = 0; attempt < 100000; attempt += 1) {
    const e = randomOddBigIntOfBits(bits);
    if (e > BIG_ONE && e < phi && bigIntGcd(e, phi) === BIG_ONE) {
      return e;
    }
  }
  throw new Error('Unable to derive a coprime SRA exponent.');
}

export async function createPlayer(props: {
  cards: number;
  publicKey?: PublicKey;
  bits?: number;
}): Promise<Player> {
  const bits = normalizeMentalPokerBits(props.bits);

  // The first player generates the shared modulus (p,q) once (the only place we
  // still pay for prime generation); every other key reuses that modulus and only
  // needs a fresh coprime exponent, which is cheap.
  const mainSraKey = props.publicKey
    ? await generateShamirRivestAdleman({
        bits,
        keys: {
          p: props.publicKey.p,
          q: props.publicKey.q,
          e: generateCoprimeExponent(props.publicKey, bits),
        },
      })
    : await generateShamirRivestAdleman({ bits });

  const sharedPublicKey = mainSraKey.publicKey;
  const individualSraKeys: ShamirRivestAdleman[] = [];
  for (let i = 0; i < props.cards; i += 1) {
    individualSraKeys.push(await generateShamirRivestAdleman({
      bits,
      keys: {
        p: sharedPublicKey.p,
        q: sharedPublicKey.q,
        e: generateCoprimeExponent(sharedPublicKey, bits),
      },
    }));
  }

  return new Player({ mainSraKey, individualSraKeys });
}
