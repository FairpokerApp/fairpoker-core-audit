import MentalPokerGameRoom, {MentalPokerEvent} from "./MentalPokerGameRoom";
import GameRoom, {WireGameEvent} from "./GameRoom";
import {TexasHoldemGameRoom, TexasHoldemTableEvent} from "./texas-holdem/TexasHoldemGameRoom";
import ChatRoom, {ChatRoomEvent} from "./ChatRoom";
import CloudflareRelayTransport from "./CloudflareRelayTransport";
import WorkerRelayMesh from "./WorkerRelayMesh";
import {
  createEventSigner,
  generateSigningIdentity,
  SigningIdentity,
} from "./fairness/eventSigning";
import {getClientVersionClaim} from "./clientVersion";
import {
  CryptoKeyBundle,
  DandelionMesh,
  generateKeyBundle,
  LocalStorageRaftLog,
  PeerJSTransport,
} from "dandelion-mesh";
import {getOptionalBuildEnv, getSignalingUrl} from "./signalingConfig";
import {getActiveAuthSession} from "./auth";
import {
  readRegisteredItem,
  REGISTERED_KEY_BUNDLE,
  REGISTERED_PEER_ID,
  REGISTERED_SIGNING_IDENTITY,
  resetRegisteredIdentity,
  writeRegisteredItem,
} from "./registeredIdentity";

type AllEvents = MentalPokerEvent | ChatRoomEvent | TexasHoldemTableEvent;

const MODULUS_LENGTH = 2048;
const GAME_ROOM_ID_PARAM = 'gameRoomId';
const TABLE_ID_PARAM = 'tableId';

/**
 * Derive a short, deterministic peer ID from an RSA public key JWK.
 * Uses SHA-256 of the canonical JSON, then encodes the first 8 bytes as
 * base36 — similar in spirit to a Bitcoin address checksum.
 */
/**
 * Load or generate a CryptoKeyBundle for this session.
 * On first load, generates a new RSA key pair, stores the JWK representations
 * in sessionStorage. On refresh, reloads the stored keys.
 */
async function getOrCreateSessionKeyBundle(): Promise<CryptoKeyBundle> {
  const storedBundle = readRegisteredItem(REGISTERED_KEY_BUNDLE);

  if (storedBundle) {
    writeRegisteredItem(REGISTERED_KEY_BUNDLE, storedBundle);
    const { publicKeyJwk, privateKeyJwk } = JSON.parse(storedBundle);
    const publicKey = await crypto.subtle.importKey(
      'jwk', publicKeyJwk,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      true,
      ['encrypt'],
    );
    const privateKey = await crypto.subtle.importKey(
      'jwk', privateKeyJwk,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      true,
      ['decrypt'],
    );
    return { publicKey, privateKey, publicKeyJwk };
  }

  // First load — generate new keys
  const bundle = await generateKeyBundle(MODULUS_LENGTH);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', bundle.privateKey);

  writeRegisteredItem(REGISTERED_KEY_BUNDLE, JSON.stringify({
    publicKeyJwk: bundle.publicKeyJwk,
    privateKeyJwk,
  }));

  return bundle;
}

async function getOrCreateSigningIdentity(): Promise<SigningIdentity> {
  const storedIdentity = readRegisteredItem(REGISTERED_SIGNING_IDENTITY);
  if (storedIdentity) {
    const identity: SigningIdentity = JSON.parse(storedIdentity);
    writeRegisteredItem(REGISTERED_SIGNING_IDENTITY, storedIdentity);
    writeRegisteredItem(REGISTERED_PEER_ID, identity.peerId);
    return identity;
  }

  const identity = await generateSigningIdentity();
  writeRegisteredItem(REGISTERED_SIGNING_IDENTITY, JSON.stringify(identity));
  writeRegisteredItem(REGISTERED_PEER_ID, identity.peerId);
  return identity;
}

/**
 * Fetch TURN/STUN ICE servers from a configured credential endpoint.
 *
 * When the endpoint is absent, PeerJS falls back to its built-in ICE servers.
 * Any value in a Create React App environment variable is public after build, so
 * long-lived TURN credentials should eventually be issued by a backend.
 */
async function fetchMeteredIceServers(): Promise<RTCIceServer[] | undefined> {
  if (getOptionalBuildEnv(process.env.REACT_APP_PEERJS_EMPTY_ICE)?.toLowerCase() === 'true') {
    return [];
  }

  const endpoint = process.env.REACT_APP_ICE_SERVERS_ENDPOINT;
  if (!endpoint) {
    return undefined;
  }
  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error(`ICE credential endpoint responded with ${response.status}`);
    }
    return await response.json();
  } catch (err) {
    console.error('Failed to fetch ICE servers; falling back to PeerJS defaults.', err);
    return undefined;
  }
}

function normalizePeerPath(pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.toLowerCase();
  if (['1', 'true', 'yes', 'https', 'wss'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'http', 'ws'].includes(normalized)) {
    return false;
  }
  return undefined;
}

function createTableId() {
  const random = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  return `table-${random}`;
}

function publishRoomParams(tableId: string, hostId: string | undefined) {
  if (typeof window === 'undefined') {
    return;
  }
  const url = new URL(window.location.href);
  let changed = false;
  if (url.searchParams.get(TABLE_ID_PARAM) !== tableId) {
    url.searchParams.set(TABLE_ID_PARAM, tableId);
    changed = true;
  }
  if (!hostId && url.searchParams.has(GAME_ROOM_ID_PARAM)) {
    url.searchParams.delete(GAME_ROOM_ID_PARAM);
    changed = true;
  }
  if (!changed) {
    return;
  }
  window.history.replaceState(window.history.state, '', url.toString());
}

function getRoomParams(params: URLSearchParams, localPeerId?: string) {
  let hostId = params.get(GAME_ROOM_ID_PARAM) || undefined;
  if (hostId && localPeerId && hostId === localPeerId) {
    hostId = undefined;
  }

  const explicitTableId = params.get(TABLE_ID_PARAM) || undefined;
  return {
    hostId,
    tableId: explicitTableId ?? hostId ?? createTableId(),
    hasExplicitTableId: Boolean(explicitTableId),
  };
}

function getPeerServerOptions(iceServers?: RTCIceServer[]) {
  const peerOptions: {
    host?: string;
    port?: number;
    path?: string;
    secure?: boolean;
    debug?: number;
    config?: RTCConfiguration;
  } = {};

  const configuredUrl = getOptionalBuildEnv(process.env.REACT_APP_PEERJS_URL);
  if (configuredUrl) {
    try {
      const url = new URL(configuredUrl);
      peerOptions.host = url.hostname;
      peerOptions.port = url.port
        ? Number(url.port)
        : (url.protocol === 'https:' || url.protocol === 'wss:' ? 443 : 80);
      peerOptions.path = normalizePeerPath(url.pathname);
      peerOptions.secure = url.protocol === 'https:' || url.protocol === 'wss:';
    } catch (err) {
      console.error('Invalid REACT_APP_PEERJS_URL; falling back to PeerJS defaults.', err);
    }
  }

  const host = getOptionalBuildEnv(process.env.REACT_APP_PEERJS_HOST);
  const port = parseOptionalNumber(getOptionalBuildEnv(process.env.REACT_APP_PEERJS_PORT));
  const path = getOptionalBuildEnv(process.env.REACT_APP_PEERJS_PATH);
  const secure = parseOptionalBoolean(getOptionalBuildEnv(process.env.REACT_APP_PEERJS_SECURE));
  const debug = parseOptionalNumber(getOptionalBuildEnv(process.env.REACT_APP_PEERJS_DEBUG));

  if (host) {
    peerOptions.host = host;
  }
  if (port !== undefined) {
    peerOptions.port = port;
  }
  if (path) {
    peerOptions.path = normalizePeerPath(path);
  }
  if (secure !== undefined) {
    peerOptions.secure = secure;
  }
  if (debug !== undefined) {
    peerOptions.debug = debug;
  }
  if (iceServers) {
    peerOptions.config = { iceServers };
  }

  return Object.keys(peerOptions).length > 0 ? peerOptions : undefined;
}

async function initSetup() {
  const authSession = getActiveAuthSession();
  if (!authSession) {
    throw new Error('Fair Poker requires a registered account before joining a table.');
  }

  const params = new URLSearchParams(window.location.search);
  const storedIdentity = readRegisteredItem(REGISTERED_SIGNING_IDENTITY);
  let storedPeerId: string | undefined;
  if (storedIdentity) {
    try {
      const identity: SigningIdentity = JSON.parse(storedIdentity);
      storedPeerId = identity.peerId;
    } catch {
      resetRegisteredIdentity();
    }
  }

  const bundle = await getOrCreateSessionKeyBundle();
  const signingIdentity = await getOrCreateSigningIdentity();
  const peerId = signingIdentity.peerId;
  const roomParams = getRoomParams(params, storedPeerId ?? peerId);

  const iceServers = await fetchMeteredIceServers();
  const peerOptions = getPeerServerOptions(iceServers);

  const bootstrapPeers = roomParams.hostId ? [roomParams.hostId] : [];
  const tableId = roomParams.tableId;
  if (!roomParams.hasExplicitTableId || params.get(TABLE_ID_PARAM) !== tableId || !roomParams.hostId) {
    publishRoomParams(tableId, roomParams.hostId);
  }
  const roomId = tableId;
  // Bind every signed event to this table so it cannot be replayed into another.
  const eventSigner = await createEventSigner(signingIdentity, {tableId});

  const signalingUrl = getSignalingUrl();
  const mesh = signalingUrl
    ? new WorkerRelayMesh<WireGameEvent<AllEvents>>(new CloudflareRelayTransport({
      serverUrl: signalingUrl,
      roomId,
      peerId,
      authToken: authSession.token,
    }))
    : (() => {
      const transport = new PeerJSTransport({
        peerId,
        ...(peerOptions ? { peerOptions } : {}),
      });
      const dandelionMesh = new DandelionMesh<WireGameEvent<AllEvents>>(transport, {
        bootstrapPeers,
        modulusLength: MODULUS_LENGTH,
        cryptoKeyBundle: bundle,
        raftLog: new LocalStorageRaftLog(`fair-poker:${roomId}:${peerId}`),
      });
      (dandelionMesh as DandelionMesh<WireGameEvent<AllEvents>> & { connect: (remotePeerId: string) => void }).connect = (remotePeerId) => {
        if (remotePeerId !== peerId) {
          transport.connect(remotePeerId);
        }
      };
      return dandelionMesh;
    })();

  const gameRoom = new GameRoom<AllEvents>(mesh, {
    hostId: roomParams.hostId,
    eventSigner,
    expectedTableId: tableId,
    rejectUnsignedEvents: true,
  });

  const mentalPokerGameRoom = new MentalPokerGameRoom(gameRoom, roomId, {
    privateKey: bundle.privateKey,
    publicKeyJwk: bundle.publicKeyJwk,
  });
  const texasHoldem = new TexasHoldemGameRoom(gameRoom, mentalPokerGameRoom);

  const chat = new ChatRoom(gameRoom);
  void chat.announceClientVersion(getClientVersionClaim());
  // Publish our RSA encryption public key so peers can seal private per-card
  // keys to us end-to-end; the relay then only ever sees ciphertext. (B03/B04.)
  void mentalPokerGameRoom.announceEncryptionKey();

  window.addEventListener('beforeunload', () => {
    texasHoldem.close();
    chat.close();
    gameRoom.close();
  });

  return {
    HostId: gameRoom.hostId,
    TableId: tableId,
    TexasHoldem: texasHoldem,
    Chat: chat,
  };
}

let setupPromise: Promise<{
  HostId: string | undefined;
  TableId: string;
  TexasHoldem: TexasHoldemGameRoom;
  Chat: ChatRoom;
}> | undefined;

// Re-export individual values for backward compatibility.
// These are set once setupReady resolves. Consumers that render after
// setupReady (gated in index.tsx) can use them directly.
export let HostId: string | undefined;
export let TableId = '';
export let TexasHoldem: TexasHoldemGameRoom;
export let Chat: ChatRoom;

// True once initSetup has resolved and the module-level singletons are assigned.
// Read live (the value flips back to undefined if a dev hot-reload re-evaluates
// this module) so a ready gate can avoid rendering the table against an undefined
// TexasHoldem and white-screening.
export function isSetupReady(): boolean {
  return TexasHoldem !== undefined;
}

export function ensureSetupReady() {
  if (!setupPromise) {
    setupPromise = initSetup().then(({ HostId: h, TableId: table, TexasHoldem: t, Chat: c }) => {
      HostId = h;
      TableId = table;
      TexasHoldem = t;
      Chat = c;
      return { HostId, TableId, TexasHoldem, Chat };
    });
  }
  return setupPromise;
}

export const setupReady = {
  then<TResult1 = {
    HostId: string | undefined;
    TableId: string;
    TexasHoldem: TexasHoldemGameRoom;
    Chat: ChatRoom;
  }, TResult2 = never>(
    onfulfilled?: ((value: {
      HostId: string | undefined;
      TableId: string;
      TexasHoldem: TexasHoldemGameRoom;
      Chat: ChatRoom;
    }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return ensureSetupReady().then(onfulfilled, onrejected);
  },
} as PromiseLike<{
  HostId: string | undefined;
  TableId: string;
  TexasHoldem: TexasHoldemGameRoom;
  Chat: ChatRoom;
}>;
