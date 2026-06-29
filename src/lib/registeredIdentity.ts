import {SigningIdentity} from "./fairness/eventSigning";

export const REGISTERED_KEY_BUNDLE = 'fair-poker:keyBundle';
export const REGISTERED_PEER_ID = 'fair-poker:peerId';
export const REGISTERED_SIGNING_IDENTITY = 'fairpoker:signingIdentity';

export interface StoredKeyBundle {
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
}

export interface RegisteredIdentityVault {
  signingIdentity: SigningIdentity;
  keyBundle: StoredKeyBundle;
}

export function readRegisteredItem(key: string): string | null {
  return localStorage.getItem(key) ?? sessionStorage.getItem(key);
}

export function writeRegisteredItem(key: string, value: string) {
  localStorage.setItem(key, value);
  sessionStorage.setItem(key, value);
}

export function resetRegisteredIdentity() {
  sessionStorage.removeItem(REGISTERED_KEY_BUNDLE);
  sessionStorage.removeItem(REGISTERED_PEER_ID);
  sessionStorage.removeItem(REGISTERED_SIGNING_IDENTITY);
  localStorage.removeItem(REGISTERED_KEY_BUNDLE);
  localStorage.removeItem(REGISTERED_PEER_ID);
  localStorage.removeItem(REGISTERED_SIGNING_IDENTITY);
}

export function installRegisteredIdentityVault(vault: RegisteredIdentityVault) {
  writeRegisteredItem(REGISTERED_KEY_BUNDLE, JSON.stringify(vault.keyBundle));
  writeRegisteredItem(REGISTERED_SIGNING_IDENTITY, JSON.stringify(vault.signingIdentity));
  writeRegisteredItem(REGISTERED_PEER_ID, vault.signingIdentity.peerId);
}
