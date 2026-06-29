// Compares the CID the client is actually running from against the authoritative
// Game client CID in the canonical release. Lets the UI show whether the running
// front-end is the pinned, content-addressed bundle — so a tampered or
// mis-served bundle is detectable rather than silently trusted. (Audit B12.)

import {RuntimeCodeSource} from "./runtimeCodeSource";

export type ClientCidVerification =
  // Running from an IPFS CID that matches the canonical Game client CID.
  | {status: 'verified'; cid: string}
  // Running from IPFS, but the CID differs from the canonical one — a different
  // bundle is being served. This is the alarming case the UI must surface.
  | {status: 'mismatch'; runningCid: string; canonicalCid: string}
  // Not loaded from a pinned IPFS CID (domain mirror / local) — cannot be
  // content-verified this way; the user should use the fixed IPFS entry.
  | {status: 'not-pinned'}
  // Canonical release identity not loaded yet (ai.json not fetched).
  | {status: 'unknown'};

export function verifyRunningClientCid(
  codeSource: RuntimeCodeSource,
  canonicalGameClientCid: string,
): ClientCidVerification {
  if (codeSource.kind !== 'ipfs') {
    return {status: 'not-pinned'};
  }
  if (!canonicalGameClientCid) {
    return {status: 'unknown'};
  }
  if (codeSource.cid === canonicalGameClientCid) {
    return {status: 'verified', cid: codeSource.cid};
  }
  return {status: 'mismatch', runningCid: codeSource.cid, canonicalCid: canonicalGameClientCid};
}
