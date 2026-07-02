// Live, in-browser fairness audit for a finished hand. This runs the SAME core
// integrity judgments the offline transcript verifier makes (scripts/
// verify-transcript.js) — finalized-deck size/uniqueness, full multi-party
// shuffle participation, public-record consensus across players, and signed
// events — but over the transcript the client already holds, so a player gets an
// automatic verdict at hand end instead of only tamper-evident evidence they must
// verify by hand. (Audit B09/D05: turn passive evidence into an active check.)
//
// Design rules that must hold:
// - Informational only. Callers surface the result (overlay / security panel);
//   they MUST NOT block, freeze, or void gameplay on it. Fail-open.
// - A check it cannot evaluate yet (e.g. no peer receipts collected) is 'pending',
//   never 'warn'. Only a concrete detected anomaly is 'warn'.

import {canonicalHandHash, evaluateHandConsensus} from "./handConsensus";
import {isSignedGameEvent} from "./eventSigning";

export type IntegrityCheckId =
  | 'deckIntegrity'
  | 'fullShuffle'
  | 'recordConsensus'
  | 'signatures';

export type IntegrityStatus = 'pass' | 'warn' | 'pending';

export interface IntegrityCheck {
  id: IntegrityCheckId;
  status: IntegrityStatus;
  // Machine-readable facts for the UI to localize. Never user-facing copy.
  metrics: Record<string, number | string>;
  // Stable reason code when status === 'warn', for the UI to localize + log.
  reasonCode?: string;
}

export interface HandIntegrityResult {
  round: number;
  status: IntegrityStatus;
  checks: IntegrityCheck[];
  handHash?: string;
}

export interface AuditEntryLike {
  scope: 'public' | 'private';
  wireEvent: unknown;
}

interface DealingPayload {
  type?: string;
  round?: number;
  player?: string;
  deck?: unknown;
}

function payloadOf(wireEvent: unknown): DealingPayload | null {
  if (!wireEvent || typeof wireEvent !== 'object') {
    return null;
  }
  if (isSignedGameEvent(wireEvent)) {
    const payload = (wireEvent.payload ?? null) as DealingPayload | null;
    return payload && typeof payload === 'object' ? payload : null;
  }
  return wireEvent as DealingPayload;
}

function isDeckOf52Strings(deck: unknown): deck is string[] {
  return Array.isArray(deck) && deck.length === 52 && deck.every((c) => typeof c === 'string' && c.length > 0);
}

function hasDuplicateStrings(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

// Finalized deck must exist, hold exactly 52 ciphertexts, and contain no
// duplicate ciphertext (a duplicate ciphertext is the same card encrypted twice
// — i.e. a forged/stacked deck). Mirrors verify-transcript.js deck/finalized.
function auditDeckIntegrity(publicPayloads: DealingPayload[], round: number): IntegrityCheck {
  const finalized = publicPayloads.find((p) => p.type === 'deck/finalized' && p.round === round);
  if (!finalized) {
    return {id: 'deckIntegrity', status: 'pending', metrics: {found: 0}};
  }
  if (!isDeckOf52Strings(finalized.deck)) {
    const size = Array.isArray(finalized.deck) ? finalized.deck.length : 0;
    return {id: 'deckIntegrity', status: 'warn', metrics: {size}, reasonCode: 'deck-not-52'};
  }
  const unique = new Set(finalized.deck).size;
  if (hasDuplicateStrings(finalized.deck)) {
    return {
      id: 'deckIntegrity',
      status: 'warn',
      metrics: {size: 52, unique},
      reasonCode: 'duplicate-ciphertext',
    };
  }
  return {id: 'deckIntegrity', status: 'pass', metrics: {size: 52, unique: 52}};
}

// Every participant must have contributed BOTH an encryption-shuffle and a lock
// before the deck was finalized. This is what makes "no single party controls the
// deck" true — if a participant were skipped, the others could have fixed the
// order. Mirrors verify-transcript.js participant/lock accounting.
function auditFullShuffle(
  publicPayloads: DealingPayload[],
  round: number,
  participants: string[] | undefined,
  voided?: boolean,
): IntegrityCheck {
  if (!participants || participants.length === 0) {
    return {id: 'fullShuffle', status: 'pending', metrics: {participants: 0}};
  }
  const shuffled = new Set<string>();
  const locked = new Set<string>();
  for (const p of publicPayloads) {
    if (p.round !== round || typeof p.player !== 'string') {
      continue;
    }
    if (p.type === 'deck/shuffle') {
      shuffled.add(p.player);
    } else if (p.type === 'deck/lock') {
      locked.add(p.player);
    }
  }
  const missingShuffle = participants.filter((id) => !shuffled.has(id));
  const missingLock = participants.filter((id) => !locked.has(id));
  const metrics = {
    participants: participants.length,
    shuffled: shuffled.size,
    locked: locked.size,
  };
  if (shuffled.size === 0 && locked.size === 0) {
    // Legacy two-party protocol (no shuffle/lock events) — not evaluable here.
    return {id: 'fullShuffle', status: 'pending', metrics};
  }
  if (missingShuffle.length > 0 || missingLock.length > 0) {
    // A VOIDED hand legitimately never finished its shuffle (e.g. a mid-shuffle refresh
    // interrupted it and the deal-phase watchdog refunded the blinds), so an incomplete
    // shuffle here is expected — not evidence of cheating. Report it as not-evaluated rather
    // than a warning, so a void never surfaces a false "a player skipped the shuffle" alarm.
    if (voided) {
      return {id: 'fullShuffle', status: 'pending', metrics, reasonCode: 'voided-hand'};
    }
    return {id: 'fullShuffle', status: 'warn', metrics, reasonCode: 'incomplete-shuffle'};
  }
  return {id: 'fullShuffle', status: 'pass', metrics};
}

// Compare this player's canonical public-record hash for the hand against the
// receipts peers reported. Divergence means at least one player was fed a
// different set of public events (e.g. by a malicious relay or a tampered peer).
function auditRecordConsensus(
  localHandHash: string,
  peerReceipts: Array<{signer: string; handHash: string}>,
  round: number,
): IntegrityCheck {
  const consensus = evaluateHandConsensus(round, localHandHash, peerReceipts);
  if (consensus.status === 'pending') {
    return {id: 'recordConsensus', status: 'pending', metrics: {peers: 0}};
  }
  if (consensus.status === 'diverged') {
    return {
      id: 'recordConsensus',
      status: 'warn',
      metrics: {peers: peerReceipts.length, conflicts: consensus.conflicts.length},
      reasonCode: 'record-diverged',
    };
  }
  return {
    id: 'recordConsensus',
    status: 'pass',
    metrics: {peers: peerReceipts.length, agreed: consensus.signers.length},
  };
}

// Every public event for the hand must be signed. Unsigned public events are
// rejected live already; this surfaces a summary so the player sees it held.
function auditSignatures(publicEntries: AuditEntryLike[]): IntegrityCheck {
  let signed = 0;
  let unsigned = 0;
  for (const entry of publicEntries) {
    if (isSignedGameEvent(entry.wireEvent)) {
      signed += 1;
    } else {
      unsigned += 1;
    }
  }
  if (signed === 0 && unsigned === 0) {
    return {id: 'signatures', status: 'pending', metrics: {signed: 0, unsigned: 0}};
  }
  if (unsigned > 0) {
    return {id: 'signatures', status: 'warn', metrics: {signed, unsigned}, reasonCode: 'unsigned-event'};
  }
  return {id: 'signatures', status: 'pass', metrics: {signed, unsigned: 0}};
}

function publicEntriesForRound(entries: AuditEntryLike[], round: number): AuditEntryLike[] {
  return entries.filter((entry) => {
    if (entry.scope !== 'public') {
      return false;
    }
    const payloadRound = payloadOf(entry.wireEvent)?.round;
    return payloadRound === round;
  });
}

// Runs every check for a finished hand. Pure + deterministic given its inputs, so
// it is fully unit-testable and identical to what the offline verifier concludes.
export async function auditHandIntegrity(input: {
  entries: AuditEntryLike[];
  round: number;
  participants?: string[];
  peerReceipts?: Array<{signer: string; handHash: string}>;
  // True when the hand was VOIDED (refunded). A void — e.g. a mid-shuffle refresh that the
  // deal-phase watchdog refunded — legitimately leaves the shuffle incomplete, so the
  // "everyone shuffled" check must not raise a false cheating alarm on it.
  voided?: boolean;
}): Promise<HandIntegrityResult> {
  const {entries, round, participants, peerReceipts = [], voided = false} = input;
  const publicEntriesAll = entries.filter((entry) => entry.scope === 'public');
  const publicPayloads = publicEntriesAll
    .map((entry) => payloadOf(entry.wireEvent))
    .filter((p): p is DealingPayload => p !== null);

  const handHash = await canonicalHandHash(entries, round);

  const checks: IntegrityCheck[] = [
    auditDeckIntegrity(publicPayloads, round),
    auditFullShuffle(publicPayloads, round, participants, voided),
    auditRecordConsensus(handHash, peerReceipts, round),
    auditSignatures(publicEntriesForRound(entries, round)),
  ];

  const anyWarn = checks.some((c) => c.status === 'warn');
  const allPending = checks.every((c) => c.status === 'pending');
  const status: IntegrityStatus = anyWarn ? 'warn' : allPending ? 'pending' : 'pass';

  return {round, status, checks, handHash};
}
