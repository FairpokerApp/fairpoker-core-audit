import EventEmitter from "eventemitter3";
import {canonicalJson} from "./fairness/canonicalJson";
import Deferred from "./Deferred";
import {EventListener} from "./types";
import {
  EventSigner,
  isSignedGameEvent,
  SignedGameEvent,
  verifySignedGameEvent,
} from "./fairness/eventSigning";
import {sha256Hex} from "./fairness/hash";
import {
  TranscriptEntry,
  TranscriptRecorder,
  TranscriptSnapshot,
} from "./fairness/transcript";

export type GameRoomStatus =
  | 'NotReady'
  | 'PeerServerConnected'
  | 'HostConnected'
  | 'Closed'
;

export interface PublicGameEvent<T> {
  type: 'public';
  sender: string;
  data: T;
}

export interface PrivateGameEvent<T> {
  type: 'private';
  sender: string;
  recipient: string;
  data: T;
}

export type GameEvent<T> = PublicGameEvent<T> | PrivateGameEvent<T>;
export type WireGameEvent<T> = T | SignedGameEvent<T>;

export interface GameRoomEvents<T> {
  status: (status: GameRoomStatus) => void;
  connected: (peerId: string) => void;
  members: (members: string[]) => void;
  event: (e: T, fromWhom: string, replay?: boolean) => void;
  transcript: (entry: TranscriptEntry<unknown>) => void;
}

export type GameRoomOptions = {
  hostId?: string;
  eventSigner?: EventSigner;
  /** Binds accepted events to this table id (conservative cross-table replay guard). */
  expectedTableId?: string;
  /**
   * Security default: Fair Poker v0 table traffic rejects unsigned wire events.
   * Tests or legacy local simulations must opt out explicitly.
   */
  rejectUnsignedEvents?: boolean;
  localCommitTimeoutMs?: number;
  localCommitAttempts?: number;
}

/**
 * Minimal interface for the mesh network that GameRoom depends on.
 * This matches the public API of DandelionMesh.
 */
export interface MeshLike<T> {
  readonly peerId: string | undefined;
  readonly peers: string[];
  readonly leaderId: string | null;
  connect?(peerId: string): void;
  sendPublic(data: T): Promise<boolean>;
  sendPrivate(recipientPeerId: string, data: T): Promise<boolean>;
  on(event: 'ready', listener: (localPeerId: string) => void): void;
  on(event: 'message', listener: (message: { type: 'public'; sender: string; data: T } | { type: 'private'; sender: string; recipient: string; data: T }, replay: boolean) => void): void;
  on(event: 'peersChanged', listener: (peers: string[]) => void): void;
  on(event: 'leaderChanged', listener: (leaderId: string | null) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  off(event: string, listener: (...args: any[]) => void): void;
  close(): void;
}

// The relay's own system sender (never a real human peer); never counted as present.
const RELAY_SYSTEM_SENDER = 'worker-relay';
// PRESENCE SELF-HEAL window. A LIVE signed message proves its sender is connected right
// now. We treat such a sender as present for this long after their last message, so a peer
// who reconnected — but whom the relay's membership (mesh.peers) momentarily still lists as
// gone — is not wrongly shown "已断线"/paused while the hand is plainly still being played.
// Longer than any normal gap between a player's actions; a peer who genuinely leaves stops
// sending and drops back out after this window (so real disconnects still surface correctly).
const PRESENCE_FROM_ACTIVITY_TTL_MS = 30_000;

export default class GameRoom<T> {
  private readonly emitter = new EventEmitter<GameRoomEvents<GameEvent<T>>>();
  private readonly mesh: MeshLike<WireGameEvent<T>>;
  private readonly eventSigner?: EventSigner;
  // Public so the Texas Hold'em engine can key its funds-checkpoint to this table
  // and correctly restore carried chip balances after a refresh/reconnect.
  public readonly expectedTableId?: string;
  private readonly rejectUnsignedEvents: boolean;
  private readonly localCommitTimeoutMs: number;
  private readonly localCommitAttempts: number;
  private readonly transcript = new TranscriptRecorder<T>();
  private readonly seenWireEvents = new Set<string>();
  // peerId -> epoch ms of the last LIVE signed message we received from them (presence self-heal).
  private readonly recentSenderMs = new Map<string, number>();
  // Last members list we emitted, so we only re-emit (and re-render consumers) on real changes.
  private lastEmittedMembers: string[] | null = null;
  private readonly pendingLocalCommits = new Map<string, Array<() => void>>();

  private _status: GameRoomStatus = 'NotReady';

  public peerId?: string;
  private peerIdDeferred = new Deferred<string>();
  private leaderDeferred: Deferred<void> | null = new Deferred<void>();

  public readonly hostId?: string;

  constructor(mesh: MeshLike<WireGameEvent<T>> | MeshLike<T>, options?: GameRoomOptions) {
    this.hostId = options?.hostId;
    this.mesh = mesh as MeshLike<WireGameEvent<T>>;
    this.eventSigner = options?.eventSigner;
    this.expectedTableId = options?.expectedTableId;
    this.rejectUnsignedEvents = options?.rejectUnsignedEvents ?? true;
    this.localCommitTimeoutMs = options?.localCommitTimeoutMs ?? 5000;
    this.localCommitAttempts = options?.localCommitAttempts ?? 45;

    this.mesh.on('ready', (peerId: string) => {
      console.debug(`Connected to the signaling service. (peerId = ${peerId}).`);
      this.peerId = peerId;
      this.peerIdDeferred.resolve(peerId);
      this._status = 'PeerServerConnected';
      this.emitter.emit('status', this._status);
      this.emitter.emit('connected', peerId);

      if (!this.hostId) {
        // Room creator: emit initial members (just self)
        this.maybePushMembers();
      }
    });

    this.mesh.on('peersChanged', (_peers: string[]) => {
      // For joiners, transition to HostConnected when connected to a peer
      if (this.hostId && this._status === 'PeerServerConnected') {
        this._status = 'HostConnected';
        this.emitter.emit('status', this._status);
      }
      this.maybePushMembers();
    });

    this.mesh.on('leaderChanged', (leaderId: string | null) => {
      console.debug(`[GameRoom] leaderChanged: ${leaderId} (my peerId: ${this.peerId})`);
      if (leaderId) {
        if (this.leaderDeferred) {
          this.leaderDeferred.resolve();
          this.leaderDeferred = null;
        }
      } else {
        // Leader lost (e.g., during Raft re-election after cluster merge).
        // Create a new deferred so waitForLeader blocks until a new leader is elected.
        if (!this.leaderDeferred) {
          this.leaderDeferred = new Deferred<void>();
        }
      }
    });

    this.mesh.on('message', (msg, replay) => {
      void this.handleMeshMessage(msg, replay);
    });
  }

  private async handleMeshMessage(
    msg: { type: 'public'; sender: string; data: WireGameEvent<T> } | { type: 'private'; sender: string; recipient: string; data: WireGameEvent<T> },
    replay: boolean,
  ) {
    const eventId = await this.getWireEventId(msg);
    if (this.seenWireEvents.has(eventId)) {
      return;
    }
    const decoded = await this.decodeWireEvent(msg.data, msg.sender);
    if (!decoded) {
      return;
    }
    this.seenWireEvents.add(eventId);

    // PRESENCE SELF-HEAL: a LIVE (non-replay) signed message is proof its sender is connected
    // right now. Record it and refresh presence so a reconnected-but-active peer is never
    // wrongly shown "已断线"/paused while the hand is plainly still being played — even if the
    // relay's membership is momentarily stale. (Replay messages are history and prove nothing
    // about who is connected now, so they are excluded.)
    if (!replay && decoded.sender && decoded.sender !== this.peerId && decoded.sender !== RELAY_SYSTEM_SENDER) {
      this.recentSenderMs.set(decoded.sender, Date.now());
      this.maybePushMembers();
    }

    if (replay && decoded.sender !== this.peerId) {
      this.mesh.connect?.(decoded.sender);
    }

    const transcriptEntry = await this.transcript.append({
      transportSender: msg.sender,
      scope: msg.type,
      ...(msg.type === 'private' ? { recipient: msg.recipient } : {}),
      wireEvent: msg.data,
    });
    this.emitter.emit('transcript', transcriptEntry as TranscriptEntry<unknown>);

    let gameEvent: GameEvent<T>;
    if (msg.type === 'public') {
      gameEvent = { type: 'public', sender: decoded.sender, data: decoded.payload };
    } else {
      gameEvent = { type: 'private', sender: decoded.sender, recipient: msg.recipient, data: decoded.payload };
    }
    console.debug(`[GameRoom] received ${msg.type} message from ${decoded.sender}, replay=${replay}, dataType=${(decoded.payload as any)?.type}`);
    try {
      this.emitter.emit('event', gameEvent, decoded.sender, replay);
    } catch (e) {
      console.error(`[GameRoom] ERROR in event handler for ${(decoded.payload as any)?.type}:`, e);
    } finally {
      this.resolveLocalCommit(eventId);
    }
  }

  private async decodeWireEvent(data: WireGameEvent<T>, transportSender: string): Promise<{
    sender: string;
    payload: T;
  } | null> {
    if (!isSignedGameEvent<T>(data)) {
      if (this.rejectUnsignedEvents) {
        console.warn('[GameRoom] rejected unsigned event.');
        return null;
      }
      return {
        sender: transportSender,
        payload: data,
      };
    }

    const verification = await verifySignedGameEvent(data, transportSender);
    if (!verification.ok) {
      console.warn(`[GameRoom] rejected invalid signed event: ${verification.reason}`);
      return null;
    }

    // Conservative cross-table replay guard: reject an event whose signed tableId
    // does not match this room's table. Backward-compatible — only rejects when
    // BOTH are present and differ, so events without a bound tableId still pass.
    // (Audit B05.)
    if (this.expectedTableId && data.tableId && data.tableId !== this.expectedTableId) {
      console.warn(`[GameRoom] rejected event bound to table ${data.tableId}; this room is ${this.expectedTableId}.`);
      return null;
    }

    return {
      sender: data.sender,
      payload: data.payload,
    };
  }

  private async getWireEventId(
    msg: { type: 'public'; sender: string; data: WireGameEvent<T> } | { type: 'private'; sender: string; recipient: string; data: WireGameEvent<T> },
  ) {
    if (isSignedGameEvent<T>(msg.data)) {
      return [
        msg.type,
        msg.sender,
        msg.type === 'private' ? msg.recipient : '',
        msg.data.sender,
        msg.data.scope,
        msg.data.recipient ?? '',
        msg.data.sequence,
        msg.data.signature,
      ].join(':');
    }

    return [
      msg.type,
      msg.sender,
      msg.type === 'private' ? msg.recipient : '',
      'unsigned',
      await sha256Hex(canonicalJson(msg.data)),
    ].join(':');
  }

  private shouldApplyLocalFallback(data: WireGameEvent<T>) {
    const payload = isSignedGameEvent<T>(data) ? data.payload : data;
    const type = (payload as { type?: unknown })?.type;
    return typeof type === 'string' && (
      type.startsWith('action/')
      || type === 'start'
      || type === 'deck/shuffle'
      || type === 'deck/lock'
      || type === 'deck/finalized'
      || type === 'newRound'
    );
  }

  private resolveLocalCommit(eventId: string) {
    const waiters = this.pendingLocalCommits.get(eventId);
    if (!waiters) {
      return;
    }
    this.pendingLocalCommits.delete(eventId);
    waiters.forEach(resolve => resolve());
  }

  private waitForLocalCommit(eventId: string, timeoutMs = this.localCommitTimeoutMs): Promise<boolean> {
    if (this.seenWireEvents.has(eventId)) {
      return Promise.resolve(true);
    }
    return new Promise(resolve => {
      const done = (committed: boolean) => {
        clearTimeout(timer);
        const waiters = this.pendingLocalCommits.get(eventId);
        if (waiters) {
          const remaining = waiters.filter(waiter => waiter !== onCommit);
          if (remaining.length > 0) {
            this.pendingLocalCommits.set(eventId, remaining);
          } else {
            this.pendingLocalCommits.delete(eventId);
          }
        }
        resolve(committed);
      };
      const onCommit = () => done(true);
      const timer = setTimeout(() => done(false), timeoutMs);
      (timer as unknown as {unref?: () => void}).unref?.();
      const waiters = this.pendingLocalCommits.get(eventId) ?? [];
      waiters.push(onCommit);
      this.pendingLocalCommits.set(eventId, waiters);
    });
  }

  close() {
    this._status = 'Closed';
    this.emitter.emit('status', this._status);
    this.mesh.close();
  }

  get status() {
    return this._status;
  }

  // Presence = the relay's membership UNION any peer we've received a LIVE signed message
  // from within the self-heal window. The relay's mesh.peers can briefly be stale right after
  // a reconnect (it drops a peer and is slow to re-add them), but a freshly-arrived signed
  // message is hard proof that peer is connected now. Prunes expired senders on read so this
  // getter is always correct, with no timer. The mesh's own Raft membership is untouched.
  private computeMembers(): string[] {
    const now = Date.now();
    const present = new Set<string>(this.mesh.peers);
    for (const [peer, ms] of Array.from(this.recentSenderMs.entries())) {
      if (now - ms < PRESENCE_FROM_ACTIVITY_TTL_MS) {
        if (peer !== RELAY_SYSTEM_SENDER) {
          present.add(peer);
        }
      } else {
        this.recentSenderMs.delete(peer);
      }
    }
    return Array.from(present);
  }

  get members() {
    return this.computeMembers();
  }

  // Emit 'members' only when the computed presence actually changed, so a self-heal (or a
  // genuine departure expiring) propagates to listeners without needless re-renders.
  private maybePushMembers(): void {
    const next = this.computeMembers().slice().sort();
    const prev = this.lastEmittedMembers;
    const changed = !prev
      || prev.length !== next.length
      || next.some((peer, i) => peer !== prev[i]);
    if (changed) {
      this.lastEmittedMembers = next;
      this.emitter.emit('members', next);
    }
  }

  /**
   * Waits for the Raft leader to be elected before sending.
   * This ensures messages are not silently dropped during leader election.
   */
  private async waitForLeader(timeoutMs = 1000): Promise<boolean> {
    if (this.mesh.leaderId) return true;
    if (this.leaderDeferred) {
      await Promise.race([
        this.leaderDeferred.promise,
        new Promise(resolve => setTimeout(resolve, timeoutMs)),
      ]);
    }
    return Boolean(this.mesh.leaderId);
  }

  private async sendWithRetry(send: () => Promise<boolean>, label: string): Promise<void> {
    const MAX_RETRIES = 225;
    const RETRY_DELAY_MS = 200;
    for (let i = 0; i < MAX_RETRIES; i++) {
      const hasLeader = await this.waitForLeader(RETRY_DELAY_MS);
      if (!hasLeader) {
        if (i === 0 || i % 10 === 0) {
          console.debug(`emitEvent (${label}): leader unavailable, trying transport anyway (attempt ${i + 1}/${MAX_RETRIES}), peers=${this.mesh.peers.join(',')}`);
        }
      }
      console.debug(`sendWithRetry (${label}): calling send (attempt ${i + 1}/${MAX_RETRIES})...`);
      const result = await send();
      console.debug(`sendWithRetry (${label}): send returned ${result}`);
      if (result) return;
      if (i === 0 || i % 10 === 0) {
        console.debug(`emitEvent (${label}): send returned false (attempt ${i + 1}/${MAX_RETRIES}), leaderId=${this.mesh.leaderId}, peers=${this.mesh.peers.join(',')}`);
      }
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    }
    throw new Error(`Unable to send ${label} event after reconnect retries.`);
  }

  async emitEvent(e: GameEvent<T>) {
    const wireEvent = await this.encodeWireEvent(e);
    const transportSender = await this.peerIdAsync;
    if (e.type === 'public') {
      const shouldAwaitLocalActionCommit = this.shouldApplyLocalFallback(wireEvent);
      const localCommitId = shouldAwaitLocalActionCommit
        ? await this.getWireEventId({ type: 'public', sender: transportSender, data: wireEvent })
        : null;
      if (!shouldAwaitLocalActionCommit || !localCommitId) {
        await this.sendWithRetry(async () => this.mesh.sendPublic(wireEvent), 'public');
        return;
      }
      for (let i = 0; i < this.localCommitAttempts; i += 1) {
        await this.sendWithRetry(async () => this.mesh.sendPublic(wireEvent), 'public');
        if (await this.waitForLocalCommit(localCommitId)) {
          return;
        }
        console.debug(`emitEvent (public action): local commit not observed; retrying signed event (${i + 1}/${this.localCommitAttempts})`);
      }
      throw new Error('Unable to confirm local commit for public action event after reconnect retries.');
    } else {
      await this.sendWithRetry(async () => this.mesh.sendPrivate(e.recipient, wireEvent), `private→${e.recipient}`);
    }
  }

  private async encodeWireEvent(e: GameEvent<T>): Promise<WireGameEvent<T>> {
    if (!this.eventSigner) {
      if (this.rejectUnsignedEvents) {
        throw new Error('Cannot emit unsigned Fair Poker event while rejectUnsignedEvents is enabled.');
      }
      return e.data;
    }

    return this.eventSigner.sign({
      sender: await this.peerIdAsync,
      scope: e.type,
      ...(e.type === 'private' ? { recipient: e.recipient } : {}),
      payload: e.data,
    });
  }

  getTranscript(): TranscriptSnapshot<T> {
    return this.transcript.snapshot();
  }

  onEvent(handler: (e: GameEvent<T>, fromWhom: string) => void) {
    this.emitter.on('event', handler);
  }

  offEvent(handler?: (e: GameEvent<T>, fromWhom: string) => void) {
    this.emitter.off('event', handler);
  }

  get peerIdAsync() {
    return this.peerIdDeferred.promise;
  }

  get listener(): EventListener<GameRoomEvents<GameEvent<T>>> {
    return this.emitter;
  }
}
