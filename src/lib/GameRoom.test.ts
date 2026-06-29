import GameRoom, { GameEvent, MeshLike, WireGameEvent } from "./GameRoom";
import {createEventSigner, generateSigningIdentity, isSignedGameEvent} from "./fairness/eventSigning";

const allowUnsignedTestEvents = { rejectUnsignedEvents: false };
const fastCommitUnsignedTestEvents = { rejectUnsignedEvents: false, localCommitTimeoutMs: 10, localCommitAttempts: 3 };

type Listeners<T> = {
  ready: Array<(localPeerId: string) => void>;
  message: Array<(message: any, replay: boolean) => void>;
  peersChanged: Array<(peers: string[]) => void>;
  leaderChanged: Array<(leaderId: string | null) => void>;
  error: Array<(error: Error) => void>;
};

class MockMesh<T> implements MeshLike<T> {
  private _peerId: string | undefined;
  private _peers: string[] = [];
  private _leaderId: string | null = null;
  private listeners: Listeners<T> = {
    ready: [],
    message: [],
    peersChanged: [],
    leaderChanged: [],
    error: [],
  };

  publicSent: T[] = [];
  privateSent: Array<{ recipient: string; data: T }> = [];
  closed: boolean = false;
  deliverToSelf: boolean = true;
  selfDeliveryDelayMs: number = 0;
  selfDeliveriesToSkip: number = 0;

  private paired: MockMesh<T>[] = [];

  get peerId() { return this._peerId; }
  get peers() { return this._peers; }
  get leaderId() { return this._leaderId; }

  async sendPublic(data: T): Promise<boolean> {
    this.publicSent.push(data);
    // Simulate Raft commit: deliver to self and all paired meshes
    const msg = { type: 'public' as const, sender: this._peerId!, data };
    if (this.deliverToSelf) {
      if (this.selfDeliveriesToSkip > 0) {
        this.selfDeliveriesToSkip -= 1;
      } else if (this.selfDeliveryDelayMs > 0) {
        setTimeout(() => this.emit('message', msg, false), this.selfDeliveryDelayMs);
      } else {
        this.emit('message', msg, false);
      }
    }
    for (const peer of this.paired) {
      peer.emit('message', msg, false);
    }
    return true;
  }

  async sendPrivate(recipientPeerId: string, data: T): Promise<boolean> {
    this.privateSent.push({ recipient: recipientPeerId, data });
    // Simulate Raft commit + decryption: deliver to sender and recipient only
    const msg = { type: 'private' as const, sender: this._peerId!, recipient: recipientPeerId, data };
    if (this.deliverToSelf) {
      if (this.selfDeliveryDelayMs > 0) {
        setTimeout(() => this.emit('message', msg, false), this.selfDeliveryDelayMs);
      } else {
        this.emit('message', msg, false);
      }
    }
    for (const peer of this.paired) {
      if (peer._peerId === recipientPeerId) {
        peer.emit('message', msg, false);
      }
    }
    return true;
  }

  on(event: string, listener: (...args: any[]) => void): void {
    const list = this.listeners[event as keyof Listeners<T>];
    if (list) {
      list.push(listener);
    }
  }

  off(event: string, listener: (...args: any[]) => void): void {
    const list = this.listeners[event as keyof Listeners<T>];
    if (list) {
      const idx = list.indexOf(listener);
      if (idx >= 0) list.splice(idx, 1);
    }
  }

  close(): void {
    this.closed = true;
  }

  // Test helpers

  emit(event: string, ...args: any[]) {
    const list = this.listeners[event as keyof Listeners<T>];
    if (list) {
      for (const listener of [...list]) {
        (listener as Function)(...args);
      }
    }
  }

  simulateOpen(peerId: string) {
    this._peerId = peerId;
    this._peers = [peerId];
    this.emit('ready', peerId);
    // Simulate Raft leader election (single-node becomes leader immediately)
    this._leaderId = peerId;
    this.emit('leaderChanged', peerId);
  }

  simulatePeerConnected(remotePeerId: string) {
    if (!this._peers.includes(remotePeerId)) {
      this._peers.push(remotePeerId);
    }
    this.emit('peersChanged', [...this._peers]);
  }

  simulatePeerDisconnected(remotePeerId: string) {
    this._peers = this._peers.filter(p => p !== remotePeerId);
    this.emit('peersChanged', [...this._peers]);
  }

  simulateLeaderChanged(leaderId: string | null) {
    this._leaderId = leaderId;
    this.emit('leaderChanged', leaderId);
  }

  pair(other: MockMesh<T>) {
    if (!this.paired.includes(other)) {
      this.paired.push(other);
    }
    if (!other.paired.includes(this)) {
      other.paired.push(this);
    }
  }
}

describe('GameRoom', () => {
  test('status transition of a host GameRoom', async () => {
    const mesh = new MockMesh<string>();
    const gameRoom = new GameRoom(mesh);
    expect(gameRoom.status).toBe('NotReady');

    mesh.simulateOpen('host');
    expect(gameRoom.status).toBe('PeerServerConnected');

    gameRoom.close();
    expect(gameRoom.status).toBe('Closed');
    expect(mesh.closed).toBe(true);
  });

  test('status transition of a guest GameRoom', async () => {
    const mesh = new MockMesh<string>();
    const gameRoom = new GameRoom(mesh, { hostId: 'host' });
    expect(gameRoom.status).toBe('NotReady');

    mesh.simulateOpen('guest');
    expect(gameRoom.status).toBe('PeerServerConnected');

    mesh.simulatePeerConnected('host');
    expect(gameRoom.status).toBe('HostConnected');

    gameRoom.close();
    expect(gameRoom.status).toBe('Closed');
  });

  test("host's members are updated", async () => {
    const mesh = new MockMesh<string>();
    const gameRoom = new GameRoom(mesh);
    mesh.simulateOpen('host');

    expect(gameRoom.members).toEqual(['host']);

    mesh.simulatePeerConnected('guest0');
    expect(gameRoom.members).toEqual(['host', 'guest0']);

    mesh.simulatePeerConnected('guest1');
    expect(gameRoom.members).toEqual(['host', 'guest0', 'guest1']);

    mesh.simulatePeerDisconnected('guest0');
    expect(gameRoom.members).toEqual(['host', 'guest1']);
  });

  test("guest's members are updated", async () => {
    const mesh = new MockMesh<string>();
    const gameRoom = new GameRoom(mesh, { hostId: 'host' });
    mesh.simulateOpen('guest');
    expect(gameRoom.members).toEqual(['guest']);

    mesh.simulatePeerConnected('host');
    expect(gameRoom.members).toEqual(['guest', 'host']);
  });

  describe('presence self-heal from live messages', () => {
    // The presence record + 'members' emit happen INSIDE handleMeshMessage, just before it
    // emits 'event'. Awaiting the next 'event' is therefore a deterministic barrier that the
    // whole async message pipeline (decode → record → push members → emit) has fully drained —
    // no flaky fixed setTimeout under full-suite load.
    const nextEvent = (gameRoom: GameRoom<string>) => new Promise<void>(resolve => {
      const handler = () => { gameRoom.offEvent(handler); resolve(); };
      gameRoom.onEvent(handler);
    });

    test('a live message from a peer the relay momentarily dropped re-adds them to members', async () => {
      const mesh = new MockMesh<string>();
      const gameRoom = new GameRoom<string>(mesh, allowUnsignedTestEvents);
      mesh.simulateOpen('host');
      mesh.simulatePeerConnected('guest');
      expect(gameRoom.members).toEqual(['host', 'guest']);

      // Relay momentarily drops guest (stale membership right after a reconnect blip).
      mesh.simulatePeerDisconnected('guest');
      expect(gameRoom.members).toEqual(['host']);

      const membersEvents: string[][] = [];
      gameRoom.listener.on('members', m => membersEvents.push(m));

      // But guest is plainly still here: a LIVE decoded message just arrived from them.
      const processed = nextEvent(gameRoom);
      mesh.emit('message', { type: 'public', sender: 'guest', data: 'still-playing' }, false);
      await processed;

      expect(gameRoom.members).toContain('guest');
      expect(gameRoom.members).toContain('host');
      // and it announced the healed set so pause/rail consumers re-render and un-stick.
      expect(membersEvents.length).toBeGreaterThan(0);
      expect(membersEvents[membersEvents.length - 1].slice().sort()).toEqual(['guest', 'host']);
    });

    test('a REPLAY message (history) does not heal presence — it proves nothing about now', async () => {
      const mesh = new MockMesh<string>();
      const gameRoom = new GameRoom<string>(mesh, allowUnsignedTestEvents);
      mesh.simulateOpen('host');
      mesh.simulatePeerConnected('guest');
      mesh.simulatePeerDisconnected('guest');
      expect(gameRoom.members).toEqual(['host']);

      const processed = nextEvent(gameRoom);
      mesh.emit('message', { type: 'public', sender: 'guest', data: 'old-history' }, true);
      await processed;

      expect(gameRoom.members).toEqual(['host']);
    });

    test('the self-heal expires after the window if no further activity arrives', async () => {
      const nowSpy = jest.spyOn(Date, 'now');
      let clock = 1_000_000;
      nowSpy.mockImplementation(() => clock);
      try {
        const mesh = new MockMesh<string>();
        const gameRoom = new GameRoom<string>(mesh, allowUnsignedTestEvents);
        mesh.simulateOpen('host');
        mesh.simulatePeerConnected('guest');
        mesh.simulatePeerDisconnected('guest');

        const processed = nextEvent(gameRoom);
        mesh.emit('message', { type: 'public', sender: 'guest', data: 'still-here' }, false);
        await processed;
        expect(gameRoom.members).toContain('guest');

        // 31s later with no further proof of life, the heal goes stale and prunes out.
        clock += 31_000;
        expect(gameRoom.members).toEqual(['host']);
      } finally {
        nowSpy.mockRestore();
      }
    });

    test('a peer the relay still lists is unaffected (no duplicate, no spurious re-emit)', async () => {
      const mesh = new MockMesh<string>();
      const gameRoom = new GameRoom<string>(mesh, allowUnsignedTestEvents);
      mesh.simulateOpen('host');
      mesh.simulatePeerConnected('guest');

      const membersEvents: string[][] = [];
      gameRoom.listener.on('members', m => membersEvents.push(m));

      const processed = nextEvent(gameRoom);
      mesh.emit('message', { type: 'public', sender: 'guest', data: 'normal-play' }, false);
      await processed;

      // guest already a member → set unchanged, no duplicate entry, no needless re-render.
      expect(gameRoom.members).toEqual(['host', 'guest']);
      expect(membersEvents).toEqual([]);
    });
  });

  test('send public event from guest', async () => {
    const mesh = new MockMesh<string>();
    const gameRoom = new GameRoom<string>(mesh, { hostId: 'host', ...allowUnsignedTestEvents });
    mesh.simulateOpen('guest');
    mesh.simulatePeerConnected('host');

    await gameRoom.emitEvent({
      type: 'public',
      data: 'test',
      sender: 'guest',
    });
    expect(mesh.publicSent).toEqual(['test']);
  });

  test('signs outgoing events and unwraps verified events', async () => {
    const identity = await generateSigningIdentity();
    const signer = await createEventSigner(identity);
    const mesh = new MockMesh<WireGameEvent<string>>();
    const gameRoom = new GameRoom<string>(mesh, { eventSigner: signer });
    mesh.simulateOpen(identity.peerId);

    const eventPromise = new Promise<GameEvent<string>>(resolve =>
      gameRoom.onEvent(e => resolve(e))
    );

    await gameRoom.emitEvent({
      type: 'public',
      data: 'signed-test',
      sender: identity.peerId,
    });

    expect(isSignedGameEvent(mesh.publicSent[0])).toBe(true);

    const event = await eventPromise;
    expect(event.data).toBe('signed-test');
    expect(event.sender).toBe(identity.peerId);
  });

  test('rejects a verified event bound to a different table id, accepts the matching one', async () => {
    const identity = await generateSigningIdentity();
    const signer = await createEventSigner(identity, {tableId: 'table-A'});
    const signed = await signer.sign({sender: identity.peerId, scope: 'public', payload: 'hello'});

    // A receiver on table-B must reject the table-A event (cross-table replay).
    const meshB = new MockMesh<WireGameEvent<string>>();
    const roomB = new GameRoom<string>(meshB, {expectedTableId: 'table-B'});
    meshB.simulateOpen('me-b');
    const handlerB = jest.fn();
    roomB.onEvent(handlerB);
    meshB.emit('message', {type: 'public', sender: identity.peerId, data: signed}, false);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(handlerB).not.toHaveBeenCalled();

    // A receiver on table-A accepts the same event.
    const meshA = new MockMesh<WireGameEvent<string>>();
    const roomA = new GameRoom<string>(meshA, {expectedTableId: 'table-A'});
    meshA.simulateOpen('me-a');
    const received = new Promise<GameEvent<string>>(resolve => roomA.onEvent(e => resolve(e)));
    meshA.emit('message', {type: 'public', sender: identity.peerId, data: signed}, false);
    expect((await received).data).toBe('hello');
  }, 20000);

  test('rejects unsigned events by default', async () => {
    const mesh = new MockMesh<string>();
    const gameRoom = new GameRoom<string>(mesh);
    mesh.simulateOpen('peer-a');

    const eventHandler = jest.fn();
    gameRoom.onEvent(eventHandler);
    mesh.emit('message', { type: 'public', sender: 'peer-b', data: 'unsigned-test' }, false);
    await Promise.resolve();

    expect(eventHandler).not.toHaveBeenCalled();
  });

  test('does not emit unsigned events when default signature enforcement is enabled', async () => {
    const mesh = new MockMesh<string>();
    const gameRoom = new GameRoom<string>(mesh);
    mesh.simulateOpen('peer-a');

    await expect(gameRoom.emitEvent({
      type: 'public',
      data: 'unsigned-test',
      sender: 'peer-a',
    })).rejects.toThrow('Cannot emit unsigned Fair Poker event');
    expect(mesh.publicSent).toEqual([]);
  });

  function createMeshPair() {
    const hostMesh = new MockMesh<string>();
    const guestMesh = new MockMesh<string>();
    hostMesh.pair(guestMesh);
    return { hostMesh, guestMesh };
  }

  test('send public data from guest to host', async () => {
    const { hostMesh, guestMesh } = createMeshPair();
    const hostGameRoom = new GameRoom<string>(hostMesh, allowUnsignedTestEvents);
    const guestGameRoom = new GameRoom<string>(guestMesh, { hostId: 'host', ...allowUnsignedTestEvents });

    hostMesh.simulateOpen('host');
    guestMesh.simulateOpen('guest');
    hostMesh.simulatePeerConnected('guest');
    guestMesh.simulatePeerConnected('host');

    const hostEventPromise = new Promise<GameEvent<string>>(resolve =>
      hostGameRoom.onEvent(e => resolve(e))
    );

    await guestGameRoom.emitEvent({
      type: 'public',
      data: 'test',
      sender: 'guest',
    });

    const hostEvent = await hostEventPromise;
    expect(hostEvent.data).toBe('test');
    expect(hostEvent.type).toBe('public');
    expect(hostEvent.sender).toBe('guest');
  });

  test('send public data from host to guest', async () => {
    const { hostMesh, guestMesh } = createMeshPair();
    const hostGameRoom = new GameRoom<string>(hostMesh, allowUnsignedTestEvents);
    const guestGameRoom = new GameRoom<string>(guestMesh, { hostId: 'host', ...allowUnsignedTestEvents });

    hostMesh.simulateOpen('host');
    guestMesh.simulateOpen('guest');
    hostMesh.simulatePeerConnected('guest');
    guestMesh.simulatePeerConnected('host');

    const guestEventPromise = new Promise<GameEvent<string>>(resolve =>
      guestGameRoom.onEvent(e => resolve(e))
    );

    await hostGameRoom.emitEvent({
      type: 'public',
      data: 'test',
      sender: 'host',
    });

    const guestEvent = await guestEventPromise;
    expect(guestEvent.data).toBe('test');
    expect(guestEvent.type).toBe('public');
    expect(guestEvent.sender).toBe('host');
  });

  test('tries transport send when leader state is temporarily unavailable', async () => {
    const mesh = new MockMesh<string>();
    const gameRoom = new GameRoom<string>(mesh, allowUnsignedTestEvents);
    mesh.simulateOpen('host');
    mesh.simulatePeerConnected('guest');
    mesh.simulateLeaderChanged(null);

    await gameRoom.emitEvent({
      type: 'public',
      data: 'recovering-leader',
      sender: 'host',
    });

    expect(mesh.publicSent).toEqual(['recovering-leader']);
  });

  test('retries public action until local commit is observed', async () => {
    const mesh = new MockMesh<any>();
    mesh.selfDeliveriesToSkip = 1;
    const gameRoom = new GameRoom<any>(mesh, fastCommitUnsignedTestEvents);
    mesh.simulateOpen('host');

    const localEventPromise = new Promise<GameEvent<any>>(resolve =>
      gameRoom.onEvent(e => resolve(e))
    );

    await gameRoom.emitEvent({
      type: 'public',
      data: { type: 'action/bet', amount: 1 },
      sender: 'host',
    });

    const event = await localEventPromise;
    expect(event.data).toEqual({ type: 'action/bet', amount: 1 });
    expect(event.sender).toBe('host');
    expect(mesh.publicSent).toHaveLength(2);
  });

  test('waits for delayed local commit before resolving public emits', async () => {
    const mesh = new MockMesh<any>();
    mesh.selfDeliveryDelayMs = 25;
    const gameRoom = new GameRoom<any>(mesh, { rejectUnsignedEvents: false, localCommitTimeoutMs: 100 });
    mesh.simulateOpen('host');

    const eventHandler = jest.fn();
    gameRoom.onEvent(eventHandler);

    const emitPromise = gameRoom.emitEvent({
      type: 'public',
      data: { type: 'action/bet', amount: 1 },
      sender: 'host',
    });

    await Promise.resolve();
    expect(eventHandler).not.toHaveBeenCalled();

    await emitPromise;
    expect(eventHandler).toHaveBeenCalledTimes(1);
    expect(eventHandler.mock.calls[0][0].data).toEqual({ type: 'action/bet', amount: 1 });
  });

  test('broadcast data from one guest to others thru mesh', async () => {
    const mesh0 = new MockMesh<string>();
    const mesh1 = new MockMesh<string>();
    const hostMesh = new MockMesh<string>();
    mesh0.pair(mesh1);
    mesh0.pair(hostMesh);
    mesh1.pair(hostMesh);

    const hostGameRoom = new GameRoom<string>(hostMesh, allowUnsignedTestEvents);
    const guest0GameRoom = new GameRoom<string>(mesh0, { hostId: 'host', ...allowUnsignedTestEvents });
    const guest1GameRoom = new GameRoom<string>(mesh1, { hostId: 'host', ...allowUnsignedTestEvents });

    hostMesh.simulateOpen('host');
    mesh0.simulateOpen('guest0');
    mesh1.simulateOpen('guest1');

    const eventPromises = [
      new Promise<GameEvent<string>>(resolve => hostGameRoom.onEvent(e => resolve(e))),
      new Promise<GameEvent<string>>(resolve => guest0GameRoom.onEvent(e => resolve(e))),
      new Promise<GameEvent<string>>(resolve => guest1GameRoom.onEvent(e => resolve(e))),
    ];

    await guest0GameRoom.emitEvent({
      type: 'public',
      data: 'test',
      sender: 'guest0',
    });

    for (const promise of eventPromises) {
      const event = await promise;
      expect(event.data).toBe('test');
      expect(event.type).toBe('public');
      expect(event.sender).toBe('guest0');
    }
  });

  test('send private data from one guest to another', async () => {
    const mesh0 = new MockMesh<string>();
    const mesh1 = new MockMesh<string>();
    mesh0.pair(mesh1);

    const guest0GameRoom = new GameRoom<string>(mesh0, { hostId: 'host', ...allowUnsignedTestEvents });
    const guest1GameRoom = new GameRoom<string>(mesh1, { hostId: 'host', ...allowUnsignedTestEvents });

    mesh0.simulateOpen('guest0');
    mesh1.simulateOpen('guest1');

    const recipientEventPromise = new Promise<GameEvent<string>>(resolve =>
      guest1GameRoom.onEvent(e => resolve(e))
    );

    await guest0GameRoom.emitEvent({
      type: 'private',
      data: 'secret',
      sender: 'guest0',
      recipient: 'guest1',
    });

    const event = await recipientEventPromise;
    expect(event.data).toBe('secret');
    expect(event.type).toBe('private');
    expect(event.sender).toBe('guest0');
  });

  test('send private data from guest to host', async () => {
    const { hostMesh, guestMesh } = createMeshPair();
    const hostGameRoom = new GameRoom<string>(hostMesh, allowUnsignedTestEvents);
    const guestGameRoom = new GameRoom<string>(guestMesh, { hostId: 'host', ...allowUnsignedTestEvents });

    hostMesh.simulateOpen('host');
    guestMesh.simulateOpen('guest');

    const hostEventPromise = new Promise<GameEvent<string>>(resolve =>
      hostGameRoom.onEvent(e => resolve(e))
    );

    await guestGameRoom.emitEvent({
      type: 'private',
      data: 'secret',
      sender: 'guest',
      recipient: 'host',
    });

    const event = await hostEventPromise;
    expect(event.data).toBe('secret');
    expect(event.type).toBe('private');
    expect(event.sender).toBe('guest');
  });

  test('send private data from host to guest', async () => {
    const { hostMesh, guestMesh } = createMeshPair();
    const hostGameRoom = new GameRoom<string>(hostMesh, allowUnsignedTestEvents);
    const guestGameRoom = new GameRoom<string>(guestMesh, { hostId: 'host', ...allowUnsignedTestEvents });

    hostMesh.simulateOpen('host');
    guestMesh.simulateOpen('guest');

    const guestEventPromise = new Promise<GameEvent<string>>(resolve =>
      guestGameRoom.onEvent(e => resolve(e))
    );

    await hostGameRoom.emitEvent({
      type: 'private',
      data: 'secret',
      sender: 'host',
      recipient: 'guest',
    });

    const event = await guestEventPromise;
    expect(event.data).toBe('secret');
    expect(event.type).toBe('private');
    expect(event.sender).toBe('host');
  });

  test('resources are released after closed', async () => {
    const { hostMesh, guestMesh } = createMeshPair();
    const hostGameRoom = new GameRoom<string>(hostMesh, allowUnsignedTestEvents);
    const guestGameRoom = new GameRoom<string>(guestMesh, { hostId: 'host', ...allowUnsignedTestEvents });

    hostMesh.simulateOpen('host');
    guestMesh.simulateOpen('guest');

    guestGameRoom.close();
    hostGameRoom.close();

    expect(guestMesh.closed).toBe(true);
    expect(hostMesh.closed).toBe(true);
  });
});
