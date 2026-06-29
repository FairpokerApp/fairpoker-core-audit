// End-to-end sealing of private per-card decryption keys.
//
// Background: the per-card decryption key {d,n} in a private `card/decrypt`
// event is what reveals a hole card. Today it travels through the Cloudflare
// relay in plaintext, so the relay can read it (audit B03/B04). This module
// seals that key to the *recipient's* public encryption key (the RSA-OAEP
// keyBundle every registered player already has), so the relay only ever sees
// ciphertext.
//
// The sealed envelope also carries a binding (sender, recipient, round,
// cardOffset, handId). The recipient verifies the binding after decrypting, so a
// relay/peer cannot take a sealed key and replay it as a different card, round,
// or recipient — the binding would not match and decryption is rejected.
//
// Only PRIVATE card/decrypt events are sealed. Public reveals (board, showdown)
// stay plaintext on purpose: they must remain independently verifiable by the
// offline transcript verifier.

import {decrypt as hybridDecrypt, encrypt as hybridEncrypt} from "../HybridPublicKeyCrypto";
import {base64UrlToBytes, bytesToBase64Url, utf8Bytes} from "./encoding";

export const SEALED_CARD_KEY_KIND = 'fairpoker.sealed-card-key.v1';

export interface CardKeyBinding {
  sender: string;
  recipient: string;
  round: number;
  cardOffset: number;
  handId?: string;
}

export interface CardKeyMaterial {
  d: string;
  n: string;
}

interface SealedEnvelope {
  kind: typeof SEALED_CARD_KEY_KIND;
  binding: CardKeyBinding;
  key: CardKeyMaterial;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.slice().buffer;
}

function bindingMatches(a: CardKeyBinding, b: CardKeyBinding): boolean {
  return a.sender === b.sender
    && a.recipient === b.recipient
    && a.round === b.round
    && a.cardOffset === b.cardOffset
    && (a.handId ?? '') === (b.handId ?? '');
}

// Seals a per-card key to the recipient's RSA-OAEP public key. Returns a
// base64url string suitable for the wire.
export async function sealCardKey(
  key: CardKeyMaterial,
  binding: CardKeyBinding,
  recipientPublicKey: CryptoKey,
): Promise<string> {
  const envelope: SealedEnvelope = {kind: SEALED_CARD_KEY_KIND, binding, key};
  const cipher = await hybridEncrypt(toArrayBuffer(utf8Bytes(JSON.stringify(envelope))), recipientPublicKey);
  return bytesToBase64Url(cipher);
}

// Opens a sealed per-card key with the recipient's RSA-OAEP private key and
// verifies the embedded binding matches the expected context. Throws on any
// mismatch or malformed input.
export async function openCardKey(
  sealedB64: string,
  expectedBinding: CardKeyBinding,
  recipientPrivateKey: CryptoKey,
): Promise<CardKeyMaterial> {
  const plaintext = await hybridDecrypt(toArrayBuffer(base64UrlToBytes(sealedB64)), recipientPrivateKey);
  let envelope: SealedEnvelope;
  try {
    envelope = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error('Sealed card key is not valid JSON');
  }
  if (!envelope || envelope.kind !== SEALED_CARD_KEY_KIND) {
    throw new Error('Sealed card key has an unexpected kind');
  }
  if (!envelope.binding || !bindingMatches(envelope.binding, expectedBinding)) {
    throw new Error('Sealed card key binding mismatch');
  }
  const key = envelope.key;
  if (!key || typeof key.d !== 'string' || typeof key.n !== 'string') {
    throw new Error('Sealed card key material is missing');
  }
  return {d: key.d, n: key.n};
}
