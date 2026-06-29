// Runtime schema validation for Texas Hold'em table events.
//
// Wire events arrive as untrusted JSON. TypeScript types are erased at runtime,
// so a modified or malicious client can send null, NaN, oversized numbers, wrong
// primitive types or missing fields. This module validates the structural shape
// of every table event BEFORE it reaches the game-room state machine, so invalid
// events are rejected (dropped) instead of corrupting state, throwing, or causing
// a denial of service.
//
// Design rule: this validator is intentionally *additive*. It only rejects events
// that are clearly malformed relative to the declared TexasHoldemTableEvent types.
// Any well-formed event that the existing state machine already accepts must keep
// passing unchanged. Deeper poker-rule checks (min raise, all-in bounds, turn
// order, authorization) live in the state machine and verifier, not here.
//
// Audit references: C08 (runtime schema validation), C15 (settings normalization),
// E02 (BigInt/JSON DoS via malformed input).

import {TexasHoldemTableEvent} from "../texas-holdem/TexasHoldemGameRoom";

export interface EventValidation {
  ok: boolean;
  reason?: string;
}

const VALID: EventValidation = {ok: true};

function invalid(reason: string): EventValidation {
  return {ok: false, reason};
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

// round may be omitted/null on lifecycle events (sitOut, returnToTable,
// openRegistration); when present it must be a finite number.
function isOptionalRoundRef(value: unknown): boolean {
  return value === undefined || value === null || isFiniteNumber(value);
}

// Validates the structural shape of TexasHoldemRoundSettings. Required:
// initialFundAmount finite. Optional numeric fields, when present, must be
// finite (rejects NaN/Infinity/strings). participants, when present, a string[].
export function validateRoundSettings(value: unknown): EventValidation {
  if (!isPlainObject(value)) {
    return invalid('settings must be an object');
  }
  if (!isFiniteNumber(value.initialFundAmount)) {
    return invalid('settings.initialFundAmount must be a finite number');
  }
  const optionalNumericFields = [
    'bits',
    'smallBlindAmount',
    'bigBlindAmount',
    'autoFoldTimeoutSeconds',
    'plannedRounds',
    'seriesStartRound',
  ] as const;
  for (const field of optionalNumericFields) {
    if (value[field] !== undefined && !isFiniteNumber(value[field])) {
      return invalid(`settings.${field} must be a finite number when present`);
    }
  }
  if (value.participants !== undefined && !isStringArray(value.participants)) {
    return invalid('settings.participants must be an array of strings when present');
  }
  return VALID;
}

// Validates an incoming table event by its discriminant `type`. Returns ok:true
// only for events whose required fields have the correct runtime shape.
export function validateTableEvent(value: unknown): EventValidation {
  if (!isPlainObject(value)) {
    return invalid('event must be an object');
  }
  const type = value.type;
  if (!isString(type)) {
    return invalid('event.type must be a string');
  }

  switch (type as TexasHoldemTableEvent['type']) {
    case 'newRound': {
      if (!isFiniteNumber(value.round)) {
        return invalid('newRound.round must be a finite number');
      }
      if (!isStringArray(value.players) || value.players.length < 2) {
        return invalid('newRound.players must be an array of at least 2 player ids');
      }
      if (value.players.some((player) => player.length === 0)) {
        return invalid('newRound.players must not contain empty ids');
      }
      return validateRoundSettings(value.settings);
    }
    case 'action/updateSettings':
      return validateRoundSettings(value.settings);
    case 'action/bet': {
      if (!isFiniteNumber(value.round)) {
        return invalid('bet.round must be a finite number');
      }
      // Chips are integer units, so a bet must be a non-negative safe integer.
      // This also rejects NaN/Infinity/oversized numbers before they reach the
      // betting state machine. (Audit C14, E02.)
      if (!Number.isSafeInteger(value.amount) || (value.amount as number) < 0) {
        return invalid('bet.amount must be a non-negative safe integer');
      }
      return VALID;
    }
    case 'action/fold':
      return isFiniteNumber(value.round)
        ? VALID
        : invalid('fold.round must be a finite number');
    case 'action/autoFold': {
      if (!isFiniteNumber(value.round)) {
        return invalid('autoFold.round must be a finite number');
      }
      if (!isNonEmptyString(value.target)) {
        return invalid('autoFold.target must be a non-empty string');
      }
      return VALID;
    }
    case 'action/sitOut':
      return isOptionalRoundRef(value.round)
        ? VALID
        : invalid('sitOut.round must be a finite number when present');
    case 'action/returnToTable':
      return isOptionalRoundRef(value.round)
        ? VALID
        : invalid('returnToTable.round must be a finite number when present');
    case 'action/openRegistration':
      return isOptionalRoundRef(value.round)
        ? VALID
        : invalid('openRegistration.round must be a finite number when present');
    case 'hand/result':
      return isFiniteNumber(value.round)
        ? VALID
        : invalid('hand/result.round must be a finite number');
    case 'action/voidHandVote': {
      if (!isFiniteNumber(value.round)) {
        return invalid('voidHandVote.round must be a finite number');
      }
      if (typeof value.approve !== 'boolean') {
        return invalid('voidHandVote.approve must be a boolean');
      }
      return VALID;
    }
    case 'action/cannotContinue':
      return isFiniteNumber(value.round)
        ? VALID
        : invalid('cannotContinue.round must be a finite number');
    default:
      return invalid(`unknown event type: ${type}`);
  }
}
