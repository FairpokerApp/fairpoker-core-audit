// Runtime schema validation for mental-poker wire events (round start, deck
// shuffle/lock/finalize, card decrypt).
//
// These payloads carry big-integer strings (deck ciphertexts, public-key p/q,
// per-card decryption-key d/n) that are fed straight into BigInt() and into the
// SRA crypto. A modified or malicious client could send non-numeric, oversized,
// wrong-length, or missing values that make BigInt() throw, stall on a huge
// digit string, or corrupt the deck. Validating the structural shape here lets
// the game room DROP malformed events instead of crashing, hanging, or forking
// local state.
//
// Design rule (same as eventSchema.ts): additive. Only clearly malformed events
// are rejected; any well-formed event the protocol already accepts keeps passing.
// This is a structural guard, NOT a cryptographic membership/shuffle proof —
// proving the 52 ciphertexts are a valid re-encryption permutation of a standard
// deck remains future work (see AUDIT_HARDENING_STATUS.md, C01/D08).
//
// Audit references: C03 (publicKey p/q legitimacy — structural), C04/C05 (deck
// shape), E02 (BigInt/JSON malformed-input DoS).

import {EventValidation, isFiniteNumber, isNonEmptyString, isPlainObject} from "./eventSchema";

export const STANDARD_DECK_SIZE = 52;

// Generous upper bound on the decimal length of a key/ciphertext integer string.
// Legitimate SRA values stay far below this even at several-thousand-bit sizes;
// the cap stops a multi-megabyte digit string from stalling BigInt() parsing.
export const MAX_INTEGER_STRING_LENGTH = 4096;

const INTEGER_STRING = /^-?[0-9]+$/;

export const MENTAL_POKER_EVENT_TYPES = new Set([
  'start',
  'deck/shuffle',
  'deck/lock',
  'deck/finalized',
  'card/decrypt',
  'identity/encryptionKey',
]);

export function isMentalPokerEventType(type: unknown): boolean {
  return typeof type === 'string' && MENTAL_POKER_EVENT_TYPES.has(type);
}

// A canonical decimal big-integer string, as produced by BigInt.prototype
// .toString(). Bounded length so an attacker cannot force a pathologically slow
// BigInt() parse.
export function isIntegerString(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_INTEGER_STRING_LENGTH
    && value !== '-'
    && INTEGER_STRING.test(value);
}

export function isEncodedDeck(value: unknown): boolean {
  return Array.isArray(value)
    && value.length === STANDARD_DECK_SIZE
    && value.every(isIntegerString);
}

const VALID: EventValidation = {ok: true};

function invalid(reason: string): EventValidation {
  return {ok: false, reason};
}

// Validates a mental-poker wire event. Call only when isMentalPokerEventType is
// true; other event types are not this validator's concern.
export function validateMentalPokerEvent(value: unknown): EventValidation {
  if (!isPlainObject(value)) {
    return invalid('mental-poker event must be an object');
  }
  const type = value.type;
  if (typeof type !== 'string') {
    return invalid('mental-poker event.type must be a string');
  }

  switch (type) {
    case 'start': {
      if (!isFiniteNumber(value.round)) {
        return invalid('start.round must be a finite number');
      }
      if (!isPlainObject(value.mentalPokerSettings)) {
        return invalid('start.mentalPokerSettings must be an object');
      }
      return VALID;
    }
    case 'deck/shuffle': {
      if (!isFiniteNumber(value.round)) {
        return invalid('deck/shuffle.round must be a finite number');
      }
      if (!isNonEmptyString(value.player)) {
        return invalid('deck/shuffle.player must be a non-empty string');
      }
      if (!isFiniteNumber(value.shuffleIndex)) {
        return invalid('deck/shuffle.shuffleIndex must be a finite number');
      }
      if (!isEncodedDeck(value.deck)) {
        return invalid(`deck/shuffle.deck must be ${STANDARD_DECK_SIZE} integer-string ciphertexts`);
      }
      if (value.publicKey !== undefined) {
        const publicKey = value.publicKey;
        if (!isPlainObject(publicKey)
          || !isIntegerString(publicKey.p)
          || !isIntegerString(publicKey.q)) {
          return invalid('deck/shuffle.publicKey must have integer-string p and q when present');
        }
      }
      return VALID;
    }
    case 'deck/lock': {
      if (!isFiniteNumber(value.round)) {
        return invalid('deck/lock.round must be a finite number');
      }
      if (!isNonEmptyString(value.player)) {
        return invalid('deck/lock.player must be a non-empty string');
      }
      if (!isFiniteNumber(value.lockIndex)) {
        return invalid('deck/lock.lockIndex must be a finite number');
      }
      if (!isEncodedDeck(value.deck)) {
        return invalid(`deck/lock.deck must be ${STANDARD_DECK_SIZE} integer-string ciphertexts`);
      }
      return VALID;
    }
    case 'deck/finalized': {
      if (!isFiniteNumber(value.round)) {
        return invalid('deck/finalized.round must be a finite number');
      }
      if (!isNonEmptyString(value.player)) {
        return invalid('deck/finalized.player must be a non-empty string');
      }
      if (!isEncodedDeck(value.deck)) {
        return invalid(`deck/finalized.deck must be ${STANDARD_DECK_SIZE} integer-string ciphertexts`);
      }
      return VALID;
    }
    case 'card/decrypt': {
      if (!isFiniteNumber(value.round)) {
        return invalid('card/decrypt.round must be a finite number');
      }
      const cardOffset = value.cardOffset;
      if (typeof cardOffset !== 'number'
        || !Number.isInteger(cardOffset)
        || cardOffset < 0
        || cardOffset >= STANDARD_DECK_SIZE) {
        return invalid(`card/decrypt.cardOffset must be an integer in [0,${STANDARD_DECK_SIZE})`);
      }
      // A card/decrypt carries EITHER a sealed (end-to-end encrypted) key for a
      // private deal, OR a plaintext integer-string key for a public reveal.
      const hasSealed = typeof value.sealedKey === 'string' && value.sealedKey.length > 0;
      const key = value.decryptionKey;
      const hasPlain = isPlainObject(key) && isIntegerString(key.d) && isIntegerString(key.n);
      if (!hasSealed && !hasPlain) {
        return invalid('card/decrypt must carry a sealedKey string or integer-string decryptionKey d/n');
      }
      return VALID;
    }
    case 'identity/encryptionKey': {
      if (!isPlainObject(value.publicKeyJwk)) {
        return invalid('identity/encryptionKey.publicKeyJwk must be an object');
      }
      return VALID;
    }
    default:
      return invalid(`unknown mental-poker event type: ${type}`);
  }
}
