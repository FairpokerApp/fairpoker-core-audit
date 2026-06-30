import EventEmitter from "eventemitter3";
import type {TransportEventName, TransportEvents} from "dandelion-mesh";
import {MeshLike} from "./GameRoom";

type RelayEnvelope<T> =
  | { scope: 'public'; data: T }
  | { scope: 'private'; recipient: string; data: T };

type RelayTransportLike = {
  readonly localPeerId?: string;
  readonly connectedPeers: string[];
  readonly publicSelfEcho?: boolean;
  connect(remotePeerId: string): void;
  send(remotePeerId: string, data: unknown): Promise<boolean | void>;
  broadcast(data: unknown): Promise<boolean | void>;
  close(): void;
  on<E extends TransportEventName>(event: E, listener: TransportEvents[E]): void;
  off<E extends TransportEventName>(event: E, listener: TransportEvents[E]): void;
};

type WorkerRelayMeshEvents<T> = {
  ready: (localPeerId: string) => void;
  message: (
    message:
      | { type: 'public'; sender: string; data: T; relayTs?: number }
      | { type: 'private'; sender: string; recipient: string; data: T; relayTs?: number },
    replay: boolean,
  ) => void;
  peersChanged: (peers: string[]) => void;
  leaderChanged: (leaderId: string | null) => void;
  error: (error: Error) => void;
};

function isRelayEnvelope<T>(value: unknown): value is RelayEnvelope<T> {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const envelope = value as Partial<RelayEnvelope<T>>;
  return envelope.scope === 'public' || envelope.scope === 'private';
}

export default class WorkerRelayMesh<T> implements MeshLike<T> {
  private readonly transport: RelayTransportLike;
  private readonly emitter = new EventEmitter<WorkerRelayMeshEvents<T>>();
  private _peerId?: string;
  private _peers: string[] = [];
  private _leaderId: string | null = null;

  constructor(transport: RelayTransportLike) {
    this.transport = transport;

    this.transport.on('open', this.handleOpen);
    this.transport.on('peerConnected', this.handlePeerConnected);
    this.transport.on('peerDisconnected', this.handlePeerDisconnected);
    this.transport.on('message', this.handleMessage as TransportEvents['message']);
    this.transport.on('error', this.handleError);
    this.transport.on('close', this.handleClose);
  }

  get peerId() {
    return this._peerId;
  }

  get peers() {
    return this._peers;
  }

  get leaderId() {
    return this._leaderId;
  }

  connect(peerId: string) {
    if (peerId !== this._peerId) {
      this.transport.connect(peerId);
    }
  }

  async sendPublic(data: T) {
    const sent = await this.transport.broadcast({scope: 'public', data} satisfies RelayEnvelope<T>);
    if (sent === false) {
      return false;
    }
    if (!this.transport.publicSelfEcho && this._peerId) {
      queueMicrotask(() => {
        this.emitter.emit('message', {
          type: 'public',
          sender: this._peerId!,
          data,
        }, false);
      });
    }
    return true;
  }

  async sendPrivate(recipientPeerId: string, data: T) {
    const sent = await this.transport.send(recipientPeerId, {
      scope: 'private',
      recipient: recipientPeerId,
      data,
    } satisfies RelayEnvelope<T>);
    return sent !== false;
  }

  on(event: 'ready', listener: (localPeerId: string) => void): void;
  on(
    event: 'message',
    listener: (
      message:
        | { type: 'public'; sender: string; data: T }
        | { type: 'private'; sender: string; recipient: string; data: T },
      replay: boolean,
    ) => void,
  ): void;
  on(event: 'peersChanged', listener: (peers: string[]) => void): void;
  on(event: 'leaderChanged', listener: (leaderId: string | null) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: keyof WorkerRelayMeshEvents<T>, listener: (...args: any[]) => void) {
    this.emitter.on(event, listener as never);
  }

  off(event: string, listener: (...args: any[]) => void) {
    this.emitter.off(event as keyof WorkerRelayMeshEvents<T>, listener as never);
  }

  close() {
    this.transport.off('open', this.handleOpen);
    this.transport.off('peerConnected', this.handlePeerConnected);
    this.transport.off('peerDisconnected', this.handlePeerDisconnected);
    this.transport.off('message', this.handleMessage as TransportEvents['message']);
    this.transport.off('error', this.handleError);
    this.transport.off('close', this.handleClose);
    this.transport.close();
  }

  private handleOpen = (localPeerId: string) => {
    this._peerId = localPeerId;
    this.refreshPeers();
    this._leaderId = 'worker-relay';
    this.emitter.emit('ready', localPeerId);
    this.emitter.emit('leaderChanged', this._leaderId);
    this.emitter.emit('peersChanged', this._peers);
  };

  private handlePeerConnected = () => {
    this.refreshPeers();
    this.emitter.emit('peersChanged', this._peers);
  };

  private handlePeerDisconnected = () => {
    this.refreshPeers();
    this.emitter.emit('peersChanged', this._peers);
  };

  private handleMessage = (from: string, data: unknown, replay?: boolean, relayTs?: number) => {
    if (!isRelayEnvelope<T>(data)) {
      this.emitter.emit('error', new Error('Worker relay delivered an unsupported message envelope.'));
      return;
    }
    if (data.scope === 'public') {
      this.emitter.emit('message', {
        type: 'public',
        sender: from,
        data: data.data,
        relayTs,
      }, Boolean(replay));
      return;
    }
    if (data.recipient !== this._peerId) {
      return;
    }
    this.emitter.emit('message', {
      type: 'private',
      sender: from,
      recipient: data.recipient,
      data: data.data,
      relayTs,
    }, Boolean(replay));
  };

  private handleError = (error: Error) => {
    this.emitter.emit('error', error);
  };

  private handleClose = () => {
    this._leaderId = null;
    this.emitter.emit('leaderChanged', null);
    this._peers = this._peerId ? [this._peerId] : [];
    this.emitter.emit('peersChanged', this._peers);
  };

  private refreshPeers() {
    const local = this._peerId ? [this._peerId] : [];
    this._peers = Array.from(new Set([...local, ...this.transport.connectedPeers]));
  }
}
