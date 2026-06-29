// Canonical, receiver-independent hash of a hand's PUBLIC record, so that
// different players can compare their view of the same hand and detect a
// divergent or incomplete record. (Audit B09/D05: a per-player transcript is not
// a consensus log.)
//
// Why this works: a player's local transcript finalHash is NOT comparable across
// players — it folds in local receive order, local timestamps (recordedAt), and
// the private hole-card messages addressed only to that player. Instead we build
// the hash from the SIGNATURES of the hand's PUBLIC signed events. A signature is
// computed by the sender over the event's content and is therefore identical for
// every receiver, independent of when or in what order they received it. Sorting
// the signatures removes ordering differences, so every honest player who saw the
// same set of public events for a hand computes the same hash. A player who was
// fed a different set (e.g. by a malicious relay) computes a different hash, which
// is then detectable when receipts are compared.

import {isSignedGameEvent} from "./eventSigning";
import {sha256Hex} from "./hash";

export const HAND_RECEIPT_KIND = 'fairpoker.hand-receipt.v1';

interface TranscriptEntryLike {
  scope: 'public' | 'private';
  wireEvent: unknown;
}

// Collects the sorted signatures of the public signed events that belong to the
// given round.
export function publicEventSignaturesForRound(entries: TranscriptEntryLike[], round: number): string[] {
  const signatures: string[] = [];
  for (const entry of entries) {
    if (entry.scope !== 'public') {
      continue;
    }
    const wireEvent = entry.wireEvent;
    if (!isSignedGameEvent(wireEvent)) {
      continue;
    }
    const payloadRound = (wireEvent.payload as {round?: unknown} | undefined)?.round;
    if (payloadRound !== round) {
      continue;
    }
    signatures.push(wireEvent.signature);
  }
  return signatures.sort();
}

// Computes the canonical public-record hash for a hand (round). Deterministic and
// receiver-independent — see module comment.
export async function canonicalHandHash(entries: TranscriptEntryLike[], round: number): Promise<string> {
  const signatures = publicEventSignaturesForRound(entries, round);
  return `sha256:${await sha256Hex(JSON.stringify({round, signatures}))}`;
}

export interface HandReceipt {
  round: number;
  handHash: string;
}

export type HandConsensus =
  | { status: 'agreed'; round: number; handHash: string; signers: string[] }
  | { status: 'diverged'; round: number; localHandHash: string; conflicts: Array<{ signer: string; handHash: string }> }
  | { status: 'pending'; round: number };

// Compares the local hand hash against receipts collected from peers for the same
// round. Returns 'agreed' when every received receipt matches the local hash,
// 'diverged' (with the conflicting signers) when any differ. Informational only —
// callers should surface divergence (log/UI), never block gameplay on it.
export function evaluateHandConsensus(
  round: number,
  localHandHash: string,
  peerReceipts: Array<{ signer: string; handHash: string }>,
): HandConsensus {
  if (peerReceipts.length === 0) {
    return { status: 'pending', round };
  }
  const conflicts = peerReceipts.filter((receipt) => receipt.handHash !== localHandHash);
  if (conflicts.length === 0) {
    return { status: 'agreed', round, handHash: localHandHash, signers: peerReceipts.map((r) => r.signer) };
  }
  return { status: 'diverged', round, localHandHash, conflicts };
}
