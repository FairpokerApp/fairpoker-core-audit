import {
  DecryptionKey,
  generateShamirRivestAdleman,
  PublicKey,
  ShamirRivestAdleman,
} from 'mental-poker-toolkit/build/main/lib/sra';
import { bitLength, isProbablyPrime, prime } from 'bigint-crypto-utils';

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

// ── B-1: sound SRA modulus (no weak/composite/smooth-order primes) ─────────────────────────
// The SRA modulus n = p·q is public and every participant necessarily learns its factorization
// (it is required to derive a co-modulus key), so card secrecy rests on the hardness of DISCRETE
// LOGS mod p and mod q — which COLLAPSES (Pohlig–Hellman) when p-1 or q-1 is SMOOTH (only small
// prime factors). A malicious first shuffler could otherwise ship a tiny, composite, or smooth
// modulus (the auditor's `{p:15,q:21}`) and read every hole card with zero keys. So BOTH the
// generator and the receipt validator require each prime to be ≥ MIN bits, probably prime,
// distinct, AND to carry a verifiable LARGE PRIME FACTOR in p-1 (a hard DLP subgroup). The
// generator builds p = k·q'+1 with a small even k and a large prime q', so trial-dividing p-1 by
// all primes < SMOOTH_FACTOR_BOUND recovers exactly q'; the validator then checks that recovered
// cofactor is itself a large prime. (Honest *random* primes — whose p-1 splits into several large
// primes — would FAIL that check, which is why generation uses this structure: it keeps the two
// sides consistent while staying fast. A full safe-prime search is ~a minute at 1024 bits; this is
// a few seconds.)
const SMOOTH_FACTOR_BOUND = 1 << 20; // k, hence each of its prime factors, is forced below this
const MIN_HARD_SUBGROUP_BITS = 256;  // the recovered large prime factor must be ≥ this (≥128-bit sec.)

let smallPrimesCache: bigint[] | null = null;
function smallPrimesBelow(bound: number): bigint[] {
  if (smallPrimesCache) return smallPrimesCache;
  const sieve = new Uint8Array(bound).fill(1);
  const primes: bigint[] = [];
  for (let i = 2; i < bound; i += 1) {
    if (sieve[i]) {
      primes.push(BigInt(i));
      for (let j = i * i; j < bound; j += i) sieve[j] = 0;
    }
  }
  smallPrimesCache = primes;
  return primes;
}

// Strip every prime factor < SMOOTH_FACTOR_BOUND from n, returning the remaining (hard) cofactor.
function hardCofactor(n: bigint): bigint {
  let c = n;
  for (const s of smallPrimesBelow(SMOOTH_FACTOR_BOUND)) {
    if (s * s > c) break;
    while (c % s === BIG_ZERO) c /= s;
  }
  return c;
}

// True iff `p` is a sound mental-poker modulus prime: ≥ `bits` bits, probably prime, and p-1 has a
// verifiable large prime factor (so DLP mod p is hard). Miller–Rabin via the crypto lib. (Audit B-1.)
export async function isSoundModulusPrime(p: bigint, bits: number): Promise<boolean> {
  if (typeof p !== 'bigint' || p < BIG_ONE || bitLength(p) < bits) return false;
  if (!(await isProbablyPrime(p, 40))) return false;
  const cofactor = hardCofactor(p - BIG_ONE);
  if (bitLength(cofactor) < MIN_HARD_SUBGROUP_BITS) return false;
  return isProbablyPrime(cofactor, 40);
}

// Validate a RECEIVED SRA modulus (p,q). Throws — rejecting the rigged shuffle — when either prime
// is small, composite, equal, or has a smooth order. Call before adopting a peer's modulus. (B-1.)
export async function assertSoundModulus(p: bigint, q: bigint, bits?: number): Promise<void> {
  const need = normalizeMentalPokerBits(bits);
  if (p === q) {
    throw new Error('Mental poker modulus rejected: p and q must differ.');
  }
  if (!(await isSoundModulusPrime(p, need))) {
    throw new Error('Mental poker modulus rejected: p is not a sound large prime.');
  }
  if (!(await isSoundModulusPrime(q, need))) {
    throw new Error('Mental poker modulus rejected: q is not a sound large prime.');
  }
}

// Generate a `bits`-bit prime p = k·q'+1 with a large prime q' and a small even k (< SMOOTH bound),
// so p-1 carries the verifiable large prime factor q'. Fast (regular prime search). (Audit B-1.)
async function generatePrimeWithLargeFactor(bits: number): Promise<bigint> {
  const qBits = bits - 16; // leaves headroom for k ≈ 2^15..2^16, comfortably < SMOOTH_FACTOR_BOUND
  const lowBound = BIG_ONE << BigInt(bits - 1);
  const highBound = BIG_ONE << BigInt(bits);
  const kCap = BigInt(SMOOTH_FACTOR_BOUND);
  // Cheap small-prime sieve to reject most composite candidates before the (expensive) Miller–
  // Rabin test — ~5× faster, keeping per-hand modulus generation around a second, not seconds.
  const preFilter = smallPrimesBelow(SMOOTH_FACTOR_BOUND).slice(0, 512);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const qPrime = await prime(qBits);
    const kHigh = highBound / qPrime;
    if (kHigh >= kCap) continue; // keep k (and its prime factors) below the trial-division bound
    let k = lowBound / qPrime + BIG_ONE;
    if (k % BigInt(2) !== BIG_ZERO) k += BIG_ONE;
    for (; k <= kHigh; k += BigInt(2)) {
      const candidate = k * qPrime + BIG_ONE;
      if (bitLength(candidate) !== bits) continue;
      let composite = false;
      for (const sp of preFilter) {
        if (candidate % sp === BIG_ZERO) { composite = true; break; }
      }
      if (composite) continue;
      if (await isProbablyPrime(candidate, 32)) return candidate;
    }
  }
}

// Generate a fresh SRA modulus (two distinct sound primes) for the first shuffler. (Audit B-1.)
export async function generateSoundModulus(bits: number): Promise<{ p: bigint; q: bigint }> {
  const p = await generatePrimeWithLargeFactor(bits);
  let q = await generatePrimeWithLargeFactor(bits);
  while (q === p) q = await generatePrimeWithLargeFactor(bits);
  return { p, q };
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

// Cards are encoded as PERFECT SQUARES ((cardIndex+1)^2, so 4,9,16,...,2809). A perfect
// square is a quadratic residue mod every prime, so every card shares the SAME
// (QR mod p, QR mod q) fingerprint. SRA encryption (raising to an odd power)
// preserves that fingerprint, and every participant knows p,q — so the old plain
// 1..52 encoding leaked ~2 bits about every hidden card (incl. folded hole cards)
// to anyone, with zero keys. Squaring makes all 52 fingerprints identical, closing
// the leak. (Audit V1.)
//
// Why (index+1)^2 and not index^2: index 1 (Heart-A) squares to 1, and 1 is a multiplicative
// FIXED POINT (1^e mod n == 1 under EVERY key), so its ciphertext would always be "1" — leaving
// the Heart-A identifiable in the PUBLIC encrypted deck with zero keys (and its shuffled
// position). Shifting to (index+1)^2 keeps every card a quadratic residue while moving the
// minimum to 4, so no card lands on the 0/1 fixed points and nothing leaks. (Audit R4-11.)
export function encodeStandardCard(card: StandardCard): number {
  const index = cardIndexOf(card);
  return (index + 1) * (index + 1);
}

export function isEncodedStandardCard(n: number): boolean {
  if (!Number.isInteger(n) || n < 4 || n > 53 * 53) {
    return false;
  }
  const root = Math.round(Math.sqrt(n)); // root = cardIndex + 1, i.e. 2..53 for the 52 cards
  return root >= 2 && root <= 53 && root * root === n;
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
  const zeroBased = Math.round(Math.sqrt(n)) - 2; // root = cardIndex+1; recover the 0-based index
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
    // B-1: the first shuffler generates a SOUND modulus (two large primes each with a verifiable
    // large prime factor in p-1), not an arbitrary pair — so every peer's receipt validation
    // accepts it, and a weak/composite/smooth modulus can never be slipped in.
    : await (async () => {
        const { p, q } = await generateSoundModulus(bits);
        return generateShamirRivestAdleman({ bits, keys: { p, q } });
      })();

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
