import {generateKeyBundle} from "dandelion-mesh";
import {generateSigningIdentity} from "./fairness/eventSigning";
import {base64UrlToBytes, bytesToBase64Url, utf8Bytes} from "./fairness/encoding";
import {
  installRegisteredIdentityVault,
  RegisteredIdentityVault,
  resetRegisteredIdentity,
} from "./registeredIdentity";
import {getOptionalBuildEnv, getSignalingUrl} from "./signalingConfig";
import {LanguageCode, TranslationKey, languages, translateKey} from "./i18n";

const AUTH_SESSION_KEY = 'fairpoker:authSession';
export const AUTH_SESSION_CHANGED_EVENT = 'fairpoker:auth-session-changed';
const AUTH_VAULT_VERSION = 1;
const VAULT_KDF_ITERATIONS = 120000;
const MODULUS_LENGTH = 2048;

export interface AuthSession {
  kind: 'registered';
  userId: string;
  username: string;
  token: string;
  expiresAt: number;
}

export interface EncryptedAuthVault {
  version: number;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

function cleanUsername(username: string) {
  return username.trim();
}

function activeLanguage(): LanguageCode {
  try {
    const base = localStorage.getItem('fairpoker:language')?.split('-')[0];
    return languages.some(language => language.code === base) ? base as LanguageCode : 'zh';
  } catch {
    return 'zh';
  }
}

function authText(key: TranslationKey) {
  return translateKey(activeLanguage(), key);
}

export function validateUsername(username: string) {
  const clean = cleanUsername(username);
  if (!/^[a-zA-Z0-9_\u4e00-\u9fa5-]{3,24}$/.test(clean)) {
    return authText('usernameInvalid');
  }
  return '';
}

export function validatePassword(password: string) {
  if (password.length < 8) {
    return authText('passwordMin');
  }
  if (password.length > 128) {
    return authText('passwordMax');
  }
  return '';
}

function getAuthApiBase() {
  return getOptionalBuildEnv(process.env.REACT_APP_AUTH_URL)
    ?? getSignalingUrl()
    ?? window.location.origin;
}

async function requestJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${getAuthApiBase()}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `Auth request failed (${response.status}).`);
  }
  return data;
}

export async function verifyActiveAuthSession(session: AuthSession): Promise<boolean> {
  const response = await fetch(`${getAuthApiBase()}/auth/me`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${session.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  if (response.ok) {
    return true;
  }
  if (response.status === 401) {
    return false;
  }
  const data = await response.json().catch(() => ({}));
  throw new Error(data?.error || `Auth session check failed (${response.status}).`);
}

function saveAuthSession(session: AuthSession) {
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(AUTH_SESSION_CHANGED_EVENT));
}

export function getActiveAuthSession(): AuthSession | null {
  const stored = localStorage.getItem(AUTH_SESSION_KEY);
  if (!stored) {
    return null;
  }
  try {
    const session = JSON.parse(stored) as AuthSession;
    if (
      session.kind !== 'registered'
      || !session.userId
      || !session.username
      || !session.token
      || session.expiresAt <= Date.now()
    ) {
      localStorage.removeItem(AUTH_SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    localStorage.removeItem(AUTH_SESSION_KEY);
    return null;
  }
}

export function getAuthDisplayName() {
  return getActiveAuthSession()?.username;
}

export function logout() {
  localStorage.removeItem(AUTH_SESSION_KEY);
  resetRegisteredIdentity();
  window.location.reload();
}

export function clearAuthSession() {
  localStorage.removeItem(AUTH_SESSION_KEY);
  resetRegisteredIdentity();
  window.dispatchEvent(new Event(AUTH_SESSION_CHANGED_EVENT));
}

async function createRegisteredVault(): Promise<RegisteredIdentityVault> {
  const signingIdentity = await generateSigningIdentity();
  const bundle = await generateKeyBundle(MODULUS_LENGTH);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', bundle.privateKey);
  return {
    signingIdentity,
    keyBundle: {
      publicKeyJwk: bundle.publicKeyJwk,
      privateKeyJwk,
    },
  };
}

function randomBase64Url(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function deriveVaultKey(password: string, salt: string, iterations: number) {
  const rawKey = await crypto.subtle.importKey(
    'raw',
    utf8Bytes(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: base64UrlToBytes(salt),
      iterations,
    },
    rawKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// Derives the value sent to the server for login authentication. It is a
// password-based KDF output salted by the username, and is DOMAIN-SEPARATED from
// the vault key (different salt), so the server only ever sees `authSecret` and
// never the raw password, and cannot derive the vault key from it without
// brute-forcing the password. The raw password therefore never leaves the
// browser, and the server can no longer instantly decrypt the vault. (Audit B01.)
export async function deriveAuthSecret(username: string, password: string): Promise<string> {
  const rawKey = await crypto.subtle.importKey(
    'raw',
    utf8Bytes(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const salt = new Uint8Array(
    await crypto.subtle.digest('SHA-256', utf8Bytes(`fairpoker-auth-secret:${cleanUsername(username)}`)),
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations: VAULT_KDF_ITERATIONS,
    },
    rawKey,
    256,
  );
  return bytesToBase64Url(bits);
}

export async function encryptVault(vault: RegisteredIdentityVault, password: string): Promise<EncryptedAuthVault> {
  const salt = randomBase64Url(16);
  const iv = randomBase64Url(12);
  const key = await deriveVaultKey(password, salt, VAULT_KDF_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: base64UrlToBytes(iv),
    },
    key,
    utf8Bytes(JSON.stringify(vault)),
  );
  return {
    version: AUTH_VAULT_VERSION,
    kdf: 'PBKDF2-SHA256',
    iterations: VAULT_KDF_ITERATIONS,
    salt,
    iv,
    ciphertext: bytesToBase64Url(ciphertext),
  };
}

export async function decryptVault(encrypted: EncryptedAuthVault, password: string): Promise<RegisteredIdentityVault> {
  if (encrypted.version !== AUTH_VAULT_VERSION || encrypted.kdf !== 'PBKDF2-SHA256') {
    throw new Error(authText('accountVaultUnsupported'));
  }
  const key = await deriveVaultKey(password, encrypted.salt, encrypted.iterations);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64UrlToBytes(encrypted.iv),
    },
    key,
    base64UrlToBytes(encrypted.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as RegisteredIdentityVault;
}

function installSession(session: AuthSession, vault: RegisteredIdentityVault): AuthSession {
  const registeredSession = {...session, kind: 'registered' as const};
  saveAuthSession(registeredSession);
  installRegisteredIdentityVault(vault);
  return registeredSession;
}

export async function register(username: string, password: string) {
  const usernameError = validateUsername(username);
  const passwordError = validatePassword(password);
  if (usernameError || passwordError) {
    throw new Error(usernameError || passwordError);
  }
  const vault = await createRegisteredVault();
  const encryptedVault = await encryptVault(vault, password);
  const authSecret = await deriveAuthSecret(username, password);
  const result = await requestJson<{ session: AuthSession }>('/auth/register', {
    username: cleanUsername(username),
    authSecret,
    vault: encryptedVault,
  });
  return installSession(result.session, vault);
}

export async function login(username: string, password: string) {
  const usernameError = validateUsername(username);
  const passwordError = validatePassword(password);
  if (usernameError || passwordError) {
    throw new Error(usernameError || passwordError);
  }
  const authSecret = await deriveAuthSecret(username, password);
  const result = await requestJson<{ session: AuthSession; vault: EncryptedAuthVault }>('/auth/login', {
    username: cleanUsername(username),
    authSecret,
  });
  const vault = await decryptVault(result.vault, password);
  return installSession(result.session, vault);
}

// Terms/consent version recorded alongside account creation. Bump when the
// consent copy materially changes so the ledger shows which version was accepted.
export const CONSENT_TERMS_VERSION = '2026-07-01';

export type ReportCategory = 'real_money' | 'chip_dumping' | 'collusion' | 'harassment' | 'other';

export interface ReportInput {
  category: ReportCategory;
  roomId?: string;
  reportedPeerId?: string;
  reportedUsername?: string;
  detail?: string;
}

// Submit a player report (suspected real-money gambling, chip dumping,
// collusion, harassment) to the operator backend, authenticated by the current
// member session. Never blocks or touches gameplay.
export async function submitReport(input: ReportInput): Promise<void> {
  const session = getActiveAuthSession();
  if (!session) {
    throw new Error(authText('reportNeedLogin'));
  }
  const response = await fetch(`${getAuthApiBase()}/report`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${session.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `Report failed (${response.status}).`);
  }
}

export async function enterAccount(
  username: string,
  password: string,
  options?: { agreedToTerms?: boolean },
) {
  const usernameError = validateUsername(username);
  const passwordError = validatePassword(password);
  if (usernameError || passwordError) {
    throw new Error(usernameError || passwordError);
  }
  const vault = await createRegisteredVault();
  const encryptedVault = await encryptVault(vault, password);
  const authSecret = await deriveAuthSecret(username, password);
  const result = await requestJson<{
    created: boolean;
    session: AuthSession;
    vault?: EncryptedAuthVault;
  }>('/auth/enter', {
    username: cleanUsername(username),
    authSecret,
    vault: encryptedVault,
    // Compliance: record that the 18+/no-real-money terms were accepted at entry.
    consent: options?.agreedToTerms
      ? { agreed: true, termsVersion: CONSENT_TERMS_VERSION }
      : undefined,
  });
  const activeVault = result.created
    ? vault
    : await decryptVault(result.vault as EncryptedAuthVault, password);
  return installSession(result.session, activeVault);
}
