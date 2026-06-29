import {canonicalJson} from "./canonicalJson";
import {base64UrlToBytes, bytesToBase64Url, utf8Bytes} from "./encoding";
import {sha256Base64Url, sha256Hex} from "./hash";

export const SIGNED_EVENT_KIND = 'fairpoker.signed-event.v1';

// A per-signer-instance random nonce embedded in (and therefore signed by) every
// event. It gives each signing session a distinct cryptographic domain: a page
// reload creates a new signer with a new nonce, so events from different sessions
// are separable. This lets the offline verifier scope per-sender sequence checks
// by session — so a reload that resets the local sequence counter is NOT mistaken
// for a replay — and lets a replayed event from another session be detected.
// (Audit B05/B06/B07 domain separation; no live rejection path is added.)
function randomSessionNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface SigningIdentity {
  peerId: string;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
  publicKeyFingerprint: string;
}

export interface SignedGameEvent<T> {
  kind: typeof SIGNED_EVENT_KIND;
  sender: string;
  scope: 'public' | 'private';
  recipient?: string;
  sequence: number;
  sessionNonce?: string;
  tableId?: string;
  signedAt: string;
  payload: T;
  payloadHash: string;
  publicKeyJwk: JsonWebKey;
  publicKeyFingerprint: string;
  signature: string;
}

export interface EventSigner {
  readonly identity: SigningIdentity;
  sign<T>(event: {
    sender: string;
    scope: 'public' | 'private';
    recipient?: string;
    payload: T;
  }): Promise<SignedGameEvent<T>>;
}

export interface SignedEventVerification {
  ok: boolean;
  reason?: string;
}

export function isSignedGameEvent<T>(value: unknown): value is SignedGameEvent<T> {
  return !!value
    && typeof value === 'object'
    && (value as { kind?: unknown }).kind === SIGNED_EVENT_KIND;
}

export async function generateSigningIdentity(): Promise<SigningIdentity> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicKeyFingerprint = await fingerprintPublicKey(publicKeyJwk);
  const peerId = await derivePeerIdFromSigningPublicKey(publicKeyJwk);
  return {
    peerId,
    publicKeyJwk,
    privateKeyJwk,
    publicKeyFingerprint,
  };
}

export async function derivePeerIdFromSigningPublicKey(publicKeyJwk: JsonWebKey): Promise<string> {
  const hash = await sha256Base64Url(canonicalJson(publicKeyJwk));
  return hash.slice(0, 16).toLowerCase();
}

export async function fingerprintPublicKey(publicKeyJwk: JsonWebKey): Promise<string> {
  return `sha256:${await sha256Hex(canonicalJson(publicKeyJwk))}`;
}

export async function createEventSigner(
  identity: SigningIdentity,
  context?: { tableId?: string },
): Promise<EventSigner> {
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    identity.privateKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  let sequence = 0;
  const sessionNonce = randomSessionNonce();
  // Binds every signed event to its table, so an event signed for one table
  // cannot be replayed into another while still verifying. (Audit B05.)
  const tableId = context?.tableId;

  return {
    identity,
    async sign<T>({sender, scope, recipient, payload}: {
      sender: string;
      scope: 'public' | 'private';
      recipient?: string;
      payload: T;
    }): Promise<SignedGameEvent<T>> {
      if (sender !== identity.peerId) {
        throw new Error(`Cannot sign event for ${sender}; local identity is ${identity.peerId}`);
      }

      const unsigned = {
        kind: SIGNED_EVENT_KIND as typeof SIGNED_EVENT_KIND,
        sender,
        scope,
        ...(recipient ? { recipient } : {}),
        sequence: ++sequence,
        sessionNonce,
        ...(tableId ? { tableId } : {}),
        signedAt: new Date().toISOString(),
        payload,
        payloadHash: `sha256:${await sha256Hex(canonicalJson(payload))}`,
        publicKeyJwk: identity.publicKeyJwk,
        publicKeyFingerprint: identity.publicKeyFingerprint,
      };
      const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        privateKey,
        utf8Bytes(canonicalJson(unsigned)),
      );
      return {
        ...unsigned,
        signature: bytesToBase64Url(signature),
      };
    }
  };
}

export async function verifySignedGameEvent<T>(
  event: SignedGameEvent<T>,
  transportSender: string,
): Promise<SignedEventVerification> {
  if (event.sender !== transportSender) {
    return {
      ok: false,
      reason: `Envelope sender ${event.sender} does not match transport sender ${transportSender}`,
    };
  }

  const derivedPeerId = await derivePeerIdFromSigningPublicKey(event.publicKeyJwk);
  if (derivedPeerId !== event.sender) {
    return {
      ok: false,
      reason: `Signing key derives peer id ${derivedPeerId}, not ${event.sender}`,
    };
  }

  const actualFingerprint = await fingerprintPublicKey(event.publicKeyJwk);
  if (actualFingerprint !== event.publicKeyFingerprint) {
    return {
      ok: false,
      reason: 'Public key fingerprint mismatch',
    };
  }

  const actualPayloadHash = `sha256:${await sha256Hex(canonicalJson(event.payload))}`;
  if (actualPayloadHash !== event.payloadHash) {
    return {
      ok: false,
      reason: 'Payload hash mismatch',
    };
  }

  const {signature, ...unsigned} = event;
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    event.publicKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const signatureValid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    base64UrlToBytes(signature),
    utf8Bytes(canonicalJson(unsigned)),
  );

  return signatureValid
    ? { ok: true }
    : { ok: false, reason: 'Signature verification failed' };
}
