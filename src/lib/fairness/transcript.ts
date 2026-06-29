import {canonicalJson} from "./canonicalJson";
import {isSignedGameEvent, SignedGameEvent, verifySignedGameEvent} from "./eventSigning";
import {sha256Hex} from "./hash";

export const GENESIS_TRANSCRIPT_HASH = 'sha256:genesis';

export interface TranscriptEntry<T> {
  index: number;
  previousHash: string;
  eventHash: string;
  recordedAt: string;
  transportSender: string;
  scope: 'public' | 'private';
  recipient?: string;
  signed: boolean;
  signatureValid?: boolean;
  signatureFailureReason?: string;
  payloadHash: string;
  wireEvent: T | SignedGameEvent<T>;
}

export interface TranscriptSnapshot<T> {
  version: 'fairpoker.transcript.v1';
  finalHash: string;
  entries: TranscriptEntry<T>[];
}

export interface TranscriptVerificationResult {
  ok: boolean;
  finalHash?: string;
  failedIndex?: number;
  reason?: string;
}

export class TranscriptRecorder<T> {
  private entries: TranscriptEntry<T>[] = [];
  private latestHash = GENESIS_TRANSCRIPT_HASH;
  private appendQueue: Promise<unknown> = Promise.resolve();

  async append(input: {
    transportSender: string;
    scope: 'public' | 'private';
    recipient?: string;
    wireEvent: T | SignedGameEvent<T>;
  }): Promise<TranscriptEntry<T>> {
    const appended = this.appendQueue.then(() => this.appendNow(input));
    this.appendQueue = appended.catch(() => undefined);
    return appended;
  }

  private async appendNow(input: {
    transportSender: string;
    scope: 'public' | 'private';
    recipient?: string;
    wireEvent: T | SignedGameEvent<T>;
  }): Promise<TranscriptEntry<T>> {
    const signatureCheck = isSignedGameEvent<T>(input.wireEvent)
      ? await verifySignedGameEvent(input.wireEvent, input.transportSender)
      : undefined;

    const payloadHash = isSignedGameEvent<T>(input.wireEvent)
      ? input.wireEvent.payloadHash
      : `sha256:${await sha256Hex(canonicalJson(input.wireEvent))}`;

    const unsignedEntry = {
      index: this.entries.length,
      previousHash: this.latestHash,
      recordedAt: new Date().toISOString(),
      transportSender: input.transportSender,
      scope: input.scope,
      ...(input.recipient ? { recipient: input.recipient } : {}),
      signed: isSignedGameEvent<T>(input.wireEvent),
      ...(signatureCheck ? { signatureValid: signatureCheck.ok } : {}),
      ...(signatureCheck?.reason ? { signatureFailureReason: signatureCheck.reason } : {}),
      payloadHash,
      wireEvent: input.wireEvent,
    };

    const eventHash = `sha256:${await sha256Hex(canonicalJson({
      ...unsignedEntry,
      previousHash: this.latestHash,
    }))}`;

    const entry: TranscriptEntry<T> = {
      ...unsignedEntry,
      eventHash,
    };

    this.entries.push(entry);
    this.latestHash = eventHash;
    return entry;
  }

  snapshot(): TranscriptSnapshot<T> {
    return {
      version: 'fairpoker.transcript.v1',
      finalHash: this.latestHash,
      entries: [...this.entries],
    };
  }
}

export async function verifyTranscript<T>(
  transcript: TranscriptSnapshot<T>,
): Promise<TranscriptVerificationResult> {
  let previousHash = GENESIS_TRANSCRIPT_HASH;

  for (let i = 0; i < transcript.entries.length; i++) {
    const entry = transcript.entries[i];
    if (entry.index !== i) {
      return { ok: false, failedIndex: i, reason: `Expected index ${i}, got ${entry.index}` };
    }
    if (entry.previousHash !== previousHash) {
      return { ok: false, failedIndex: i, reason: 'Previous hash mismatch' };
    }

    if (isSignedGameEvent<T>(entry.wireEvent)) {
      const verification = await verifySignedGameEvent(entry.wireEvent, entry.transportSender);
      if (!verification.ok) {
        return { ok: false, failedIndex: i, reason: verification.reason };
      }
    }

    const {eventHash, ...entryWithoutHash} = entry;
    const recomputedHash = `sha256:${await sha256Hex(canonicalJson({
      ...entryWithoutHash,
      previousHash,
    }))}`;
    if (eventHash !== recomputedHash) {
      return { ok: false, failedIndex: i, reason: 'Event hash mismatch' };
    }

    previousHash = eventHash;
  }

  if (transcript.finalHash !== previousHash) {
    return { ok: false, reason: 'Final hash mismatch' };
  }

  return {
    ok: true,
    finalHash: previousHash,
  };
}
