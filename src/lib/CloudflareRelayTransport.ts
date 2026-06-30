import type {
  TransportEventName,
  TransportEvents,
} from 'dandelion-mesh';

type RelayTransportOptions = {
  serverUrl: string;
  roomId: string;
  peerId: string;
  authToken?: string;
};

export type RelayPeerProfile = {
  peerId: string;
  accountId?: string | null;
  accountUsername?: string | null;
  connectedAt: number;
  source: string;
  browser: string;
  os: string;
  device: string;
  platform: string;
  language: string;
  timezone: string;
  country: string;
  screenBucket: string;
  hardware: string;
  ipSegment: string;
  networkFingerprint: string;
  ipConfidence: string;
  clientFingerprint: string;
};

type RelayServerMessage =
  | { type: 'welcome'; roomId: string; peerId: string; peers: string[]; profile?: RelayPeerProfile; profiles?: RelayPeerProfile[]; relay?: RelaySummary; roomRisk?: unknown; roomState?: WorkerRoomState; capabilities?: RelayCapabilities }
  | { type: 'peerJoined'; peerId: string; profile?: RelayPeerProfile; roomRisk?: unknown }
  | { type: 'peerLeft'; peerId: string }
  | { type: 'riskUpdate'; roomRisk?: unknown }
  | { type: 'roomState'; roomState?: WorkerRoomState }
  | { type: 'message'; from: string; seq?: number; ts?: number; replay?: boolean; data: unknown }
  | { type: 'error'; message: string };

type RelaySummary = {
  latestSeq: number;
  retainedFromSeq: number;
  retainedCount: number;
  maxRetainedCount: number;
};

type RelayCapabilities = {
  publicSelfEcho?: boolean;
  orderedEventLog?: boolean;
};

const liveRelaySeqByRoomAndPeer = new Map<string, number>();

// Auto-reconnect backoff bounds. The relay WebSocket is the only live link to the
// table, so an unexpected close (refresh, sleep/wake, Wi-Fi switch, worker
// redeploy) must self-heal instead of leaving the player stranded.
// The relay's own system identity (e.g. the sender of system/peerLeft). It is NOT a
// player and must never enter the peer/member set — otherwise a reconnect can surface a
// phantom "worker-relay" participant that gets seated and dealt in. Must match the worker.
const RELAY_SYSTEM_SENDER = 'worker-relay';
const BASE_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 10000;
// Cap consecutive failed reconnects that never receive a welcome. Without this,
// a structural handshake bug (e.g. Chrome rejecting an upgrade response with no
// matching Sec-WebSocket-Protocol echo) burns the console with thousands of
// failures per minute and makes the peer flap "offline" for everyone in the room.
const MAX_RECONNECTS_BEFORE_GIVING_UP = 20;

export type WorkerPlayerStatus = 'active' | 'watching' | 'sittingOut' | 'timedOut' | 'offline';

export type WorkerRoomPlayerState = {
  peerId: string;
  online: boolean;
  connected: boolean;
  seated: boolean;
  spectator?: boolean;
  status: WorkerPlayerStatus;
  timedOut?: boolean;
  sittingOut?: boolean;
};

export type WorkerRoomState = {
  version: number;
  source: 'cloudflare-worker';
  roomId: string;
  generatedAt: number;
  viewerPeerId?: string;
  latestEventSeq: number;
  currentRound: number | null;
  currentPlayers: string[];
  currentTurn: string | null;
  players: WorkerRoomPlayerState[];
  spectators?: WorkerRoomPlayerState[];
  activePlayerCount: number;
  spectatorCount?: number;
  onlineCount: number;
  roomValid: boolean;
  playable: boolean;
  reason: string;
};

function bucketNumber(value: number, step: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return 'unknown';
  }
  return String(Math.round(value / step) * step);
}

function getClientDeviceClass() {
  if (typeof window === 'undefined') {
    return 'unknown';
  }
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  if (coarse && Math.min(window.screen.width, window.screen.height) < 700) {
    return 'mobile';
  }
  if (coarse) {
    return 'tablet';
  }
  return 'desktop';
}

function appendClientHints(url: URL) {
  if (typeof window === 'undefined') {
    return;
  }
  const navigatorLike = window.navigator as Navigator & {
    deviceMemory?: number;
    userAgentData?: { platform?: string };
  };
  url.searchParams.set('tz', Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown');
  url.searchParams.set('lang', navigator.language || 'unknown');
  url.searchParams.set('platform', navigatorLike.userAgentData?.platform || navigator.platform || 'unknown');
  url.searchParams.set('device', getClientDeviceClass());
  url.searchParams.set('screen', `${bucketNumber(window.screen.width, 100)}x${bucketNumber(window.screen.height, 100)}`);
  url.searchParams.set('hw', `${navigator.hardwareConcurrency || 'unknown'}c-${navigatorLike.deviceMemory || 'unknown'}m`);
}

function writeLastRelaySeq(roomId: string, peerId: string, seq: number) {
  if (typeof window === 'undefined' || !Number.isSafeInteger(seq) || seq <= 0) {
    return;
  }
  const previous = readStoredRelaySeq(roomId, peerId);
  const liveKey = relaySeqStorageKey(roomId, peerId);
  liveRelaySeqByRoomAndPeer.set(liveKey, Math.max(liveRelaySeqByRoomAndPeer.get(liveKey) ?? 0, seq));
  if (seq <= previous) {
    return;
  }
  try {
    window.localStorage.setItem(relaySeqStorageKey(roomId, peerId), String(seq));
  } catch {
    // Reconnect replay is an optimization; storage-denied browsers can still play live.
  }
}

function relaySeqStorageKey(roomId: string, peerId: string) {
  return `fairpoker:relay:${roomId}:${peerId}:lastSeq`;
}

function readStoredRelaySeq(roomId: string, peerId: string) {
  if (typeof window === 'undefined') {
    return 0;
  }
  try {
    const value = Number(window.localStorage.getItem(relaySeqStorageKey(roomId, peerId)) || 0);
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function readLiveRelaySeq(roomId: string, peerId: string) {
  return liveRelaySeqByRoomAndPeer.get(relaySeqStorageKey(roomId, peerId)) ?? 0;
}

export const TOKEN_SUBPROTOCOL_PREFIX = 'fairpoker.token.';

// Carries the relay auth token in the WebSocket subprotocol instead of only the
// URL query, so it stays out of proxy/CDN/access logs. Browsers cannot set an
// Authorization header on a WebSocket, so the subprotocol is the available
// channel. The query token is kept for now as a fallback so the connection can
// never break; once verified, the query token can be dropped. (Audit B11.)
export function buildTokenSubprotocols(authToken?: string): string[] | undefined {
  return authToken ? [`${TOKEN_SUBPROTOCOL_PREFIX}${authToken}`] : undefined;
}

function buildWebSocketUrl(serverUrl: string, roomId: string, peerId: string, authToken?: string) {
  const url = new URL(serverUrl);
  if (url.protocol === 'https:') {
    url.protocol = 'wss:';
  } else if (url.protocol === 'http:') {
    url.protocol = 'ws:';
  }

  const basePath = url.pathname.replace(/\/+$/, '');
  url.pathname = `${basePath}/room/${encodeURIComponent(roomId)}`;
  url.searchParams.set('peerId', peerId);
  if (authToken) {
    url.searchParams.set('token', authToken);
  }
  url.searchParams.set('sinceSeq', String(readLiveRelaySeq(roomId, peerId)));
  appendClientHints(url);
  return url.toString();
}

function publishProfiles(profiles: RelayPeerProfile[]) {
  if (typeof window === 'undefined' || profiles.length === 0) {
    return;
  }
  window.dispatchEvent(new CustomEvent('fairpoker:peer-profiles', {
    detail: { profiles },
  }));
}

function publishRoomRisk(roomRisk: unknown) {
  if (typeof window === 'undefined' || !roomRisk) {
    return;
  }
  window.dispatchEvent(new CustomEvent('fairpoker:room-risk', {
    detail: { roomRisk },
  }));
}

function publishRelaySummary(relay: RelaySummary | undefined) {
  if (typeof window === 'undefined' || !relay) {
    return;
  }
  window.dispatchEvent(new CustomEvent('fairpoker:relay-summary', {
    detail: { relay },
  }));
}

function publishRoomState(roomState: WorkerRoomState | undefined) {
  if (typeof window === 'undefined' || !roomState) {
    return;
  }
  const fairPokerWindow = window as Window & {
    __fairPokerLatestRoomStates?: Map<string, WorkerRoomState>;
  };
  if (!fairPokerWindow.__fairPokerLatestRoomStates) {
    fairPokerWindow.__fairPokerLatestRoomStates = new Map();
  }
  fairPokerWindow.__fairPokerLatestRoomStates.set(roomState.roomId, roomState);
  window.dispatchEvent(new CustomEvent('fairpoker:room-state', {
    detail: { roomState },
  }));
}

export default class CloudflareRelayTransport {
  private socket: WebSocket;
  private readonly peerId: string;
  private readonly roomId: string;
  private readonly serverUrl: string;
  private readonly authToken?: string;
  private userClosed = false;
  private reconnectAttempts = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private capabilities: RelayCapabilities = {};
  private readonly connected = new Set<string>();
  private readonly listeners: {
    [K in TransportEventName]: Set<TransportEvents[K]>;
  } = {
    open: new Set(),
    peerConnected: new Set(),
    peerDisconnected: new Set(),
    message: new Set(),
    error: new Set(),
    close: new Set(),
  };

  private _localPeerId?: string;

  constructor(options: RelayTransportOptions) {
    this.peerId = options.peerId;
    this.roomId = options.roomId;
    this.serverUrl = options.serverUrl;
    this.authToken = options.authToken;
    this.socket = this.openSocket();
  }

  // Opens (or re-opens) the relay WebSocket and wires its lifecycle. On an
  // unexpected close we reconnect with capped exponential backoff, reusing the
  // same peerId and the stored sinceSeq so the worker replays everything missed
  // during the gap. The mesh re-fires `ready`/`peerConnected` on the fresh
  // welcome, which the upper layers already treat idempotently.
  private openSocket(): WebSocket {
    const socket = new WebSocket(buildWebSocketUrl(
      this.serverUrl,
      this.roomId,
      this.peerId,
      this.authToken,
    ), buildTokenSubprotocols(this.authToken));

    socket.addEventListener('message', (event) => this.handleServerMessage(event.data));
    socket.addEventListener('error', () => {
      this.emit('error', new Error('Cloudflare relay WebSocket error.'));
    });
    socket.addEventListener('close', (event) => {
      this.connected.clear();
      this.emit('close');
      // Only reconnect on UNEXPECTED drops (e.g. 1006 network loss). A normal
      // closure (code 1000) is the relay intentionally replacing this socket —
      // most importantly "Duplicate player session replaced", sent when a newer
      // session for the same peerId connects (another tab, or a hot-reloaded
      // client). Reconnecting then would fight the newer session and make both
      // flap to "offline". A user-initiated close() is also skipped.
      const intentionalClosure = (event as CloseEvent | undefined)?.code === 1000;
      if (!this.userClosed && !intentionalClosure) {
        this.scheduleReconnect();
      }
    });
    return socket;
  }

  private scheduleReconnect() {
    if (this.userClosed || this.reconnectTimer !== undefined) {
      return;
    }
    if (this.reconnectAttempts >= MAX_RECONNECTS_BEFORE_GIVING_UP) {
      this.emit('error', new Error(
        `Cloudflare relay WebSocket failed ${this.reconnectAttempts} times in a row without a welcome; giving up. Reload the page to try again.`,
      ));
      return;
    }
    const attempt = this.reconnectAttempts;
    this.reconnectAttempts += 1;
    const ceiling = Math.min(
      MAX_RECONNECT_DELAY_MS,
      BASE_RECONNECT_DELAY_MS * 2 ** Math.min(attempt, 6),
    );
    // Jitter in [ceiling/2, ceiling] avoids a thundering-herd reconnect when many
    // clients drop together (e.g., a worker redeploy).
    const delay = ceiling / 2 + Math.random() * (ceiling / 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.userClosed) {
        return;
      }
      this.socket = this.openSocket();
    }, delay);
    (this.reconnectTimer as unknown as {unref?: () => void}).unref?.();
  }

  get localPeerId() {
    return this._localPeerId;
  }

  get connectedPeers() {
    return Array.from(this.connected);
  }

  connect(remotePeerId: string) {
    if (remotePeerId === this.peerId || this.connected.has(remotePeerId)) {
      return;
    }
    this.sendControl({ type: 'connect', peerId: remotePeerId });
  }

  async send(remotePeerId: string, data: unknown) {
    return this.sendControl({
      type: 'send',
      to: remotePeerId,
      data,
    });
  }

  async broadcast(data: unknown) {
    return this.sendControl({
      type: 'broadcast',
      data,
    });
  }

  on<E extends TransportEventName>(event: E, listener: TransportEvents[E]) {
    this.listeners[event].add(listener);
  }

  off<E extends TransportEventName>(event: E, listener: TransportEvents[E]) {
    this.listeners[event].delete(listener);
  }

  close() {
    this.userClosed = true;
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.socket.close();
  }

  get publicSelfEcho() {
    return Boolean(this.capabilities.publicSelfEcho);
  }

  private handleServerMessage(raw: unknown) {
    let message: RelayServerMessage;
    try {
      message = JSON.parse(String(raw));
    } catch {
      this.emit('error', new Error('Cloudflare relay sent invalid JSON.'));
      return;
    }

    if (message.type === 'welcome') {
      // A full authenticated session was established; reset backoff so the next
      // unexpected drop starts retrying quickly again.
      this.reconnectAttempts = 0;
      this._localPeerId = message.peerId;
      this.capabilities = message.capabilities ?? {};
      publishRelaySummary(message.relay);
      publishRoomState(message.roomState);
      publishProfiles([
        ...(message.profile ? [message.profile] : []),
        ...(message.profiles ?? []),
      ]);
      publishRoomRisk(message.roomRisk);
      for (const peerId of message.peers) {
        if (peerId !== this.peerId && peerId !== RELAY_SYSTEM_SENDER) {
          this.connected.add(peerId);
        }
      }
      this.emit('open', message.peerId);
      queueMicrotask(() => {
        for (const peerId of Array.from(this.connected)) {
          this.emit('peerConnected', peerId);
        }
      });
      return;
    }

    if (message.type === 'peerJoined') {
      publishProfiles(message.profile ? [message.profile] : []);
      publishRoomRisk(message.roomRisk);
      if (message.peerId !== this.peerId && !this.connected.has(message.peerId)) {
        this.connected.add(message.peerId);
        this.emit('peerConnected', message.peerId);
      }
      return;
    }

    if (message.type === 'peerLeft') {
      if (this.connected.delete(message.peerId)) {
        this.emit('peerDisconnected', message.peerId);
      }
      return;
    }

    if (message.type === 'riskUpdate') {
      publishRoomRisk(message.roomRisk);
      return;
    }

    if (message.type === 'roomState') {
      publishRoomState(message.roomState);
      return;
    }

    if (message.type === 'message') {
      if (message.seq) {
        writeLastRelaySeq(this.roomId, this.peerId, message.seq);
      }
      if (message.from !== this.peerId && message.from !== RELAY_SYSTEM_SENDER) {
        this.connected.add(message.from);
      }
      // Forward the relay's server receive-timestamp (a trusted clock) so the reducer can
      // verify a thinking-timeout REALLY elapsed before honoring an auto-fold. (D-1.)
      this.emitTransportMessage(message.from, message.data, Boolean(message.replay), message.ts);
      return;
    }

    this.emit('error', new Error(message.message));
  }

  private sendControl(message: unknown): Promise<boolean> {
    const encoded = JSON.stringify(message);
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(encoded);
      return Promise.resolve(true);
    }
    if (this.socket.readyState !== WebSocket.CONNECTING) {
      return Promise.resolve(false);
    }
    return new Promise(resolve => {
      const cleanup = () => {
        window.clearTimeout(timer);
        this.socket.removeEventListener('open', onOpen);
        this.socket.removeEventListener('close', onClosed);
        this.socket.removeEventListener('error', onClosed);
      };
      const onOpen = () => {
        cleanup();
        try {
          this.socket.send(encoded);
          resolve(true);
        } catch {
          resolve(false);
        }
      };
      const onClosed = () => {
        cleanup();
        resolve(false);
      };
      const timer = window.setTimeout(onClosed, 1500);
      this.socket.addEventListener('open', onOpen, { once: true });
      this.socket.addEventListener('close', onClosed, { once: true });
      this.socket.addEventListener('error', onClosed, { once: true });
    });
  }

  private emit<E extends TransportEventName>(
    event: E,
    ...args: Parameters<TransportEvents[E]>
  ) {
    for (const listener of Array.from(this.listeners[event])) {
      (listener as (...args: Parameters<TransportEvents[E]>) => void)(...args);
    }
  }

  private emitTransportMessage(from: string, data: unknown, replay: boolean, relayTs?: number) {
    for (const listener of Array.from(this.listeners.message)) {
      (listener as (from: string, data: unknown, replay?: boolean, relayTs?: number) => void)(from, data, replay, relayTs);
    }
  }
}
