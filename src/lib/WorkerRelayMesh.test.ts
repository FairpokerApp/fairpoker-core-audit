import WorkerRelayMesh from "./WorkerRelayMesh";

type Listener = (...args: any[]) => void;

class MockRelayTransport {
  localPeerId?: string;
  connectedPeers: string[] = [];
  publicSelfEcho = true;
  failBroadcast = false;
  sent: Array<{to: string; data: unknown}> = [];
  broadcasts: unknown[] = [];
  closed = false;
  listeners = new Map<string, Set<Listener>>();

  connect(peerId: string) {
    if (!this.connectedPeers.includes(peerId)) {
      this.connectedPeers.push(peerId);
      this.emit('peerConnected', peerId);
    }
  }

  async send(to: string, data: unknown) {
    this.sent.push({to, data});
  }

  async broadcast(data: unknown) {
    if (this.failBroadcast) {
      return false;
    }
    this.broadcasts.push(data);
    return true;
  }

  close() {
    this.closed = true;
    this.emit('close');
  }

  on(event: string, listener: Listener) {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, ...args: any[]) {
    for (const listener of Array.from(this.listeners.get(event) ?? [])) {
      listener(...args);
    }
  }

  open(peerId: string, peers: string[] = []) {
    this.localPeerId = peerId;
    this.connectedPeers = peers;
    this.emit('open', peerId);
  }
}

test('uses the worker relay as the authoritative leader and member source', () => {
  const transport = new MockRelayTransport();
  const mesh = new WorkerRelayMesh<string>(transport);
  const ready = jest.fn();
  const leaderChanged = jest.fn();
  const peersChanged = jest.fn();

  mesh.on('ready', ready);
  mesh.on('leaderChanged', leaderChanged);
  mesh.on('peersChanged', peersChanged);

  transport.open('p1', ['p2']);

  expect(mesh.peerId).toBe('p1');
  expect(mesh.leaderId).toBe('worker-relay');
  expect(mesh.peers).toEqual(['p1', 'p2']);
  expect(ready).toHaveBeenCalledWith('p1');
  expect(leaderChanged).toHaveBeenCalledWith('worker-relay');
  expect(peersChanged).toHaveBeenLastCalledWith(['p1', 'p2']);
});

test('wraps public and private messages for worker-ordered delivery', async () => {
  const transport = new MockRelayTransport();
  const mesh = new WorkerRelayMesh<string>(transport);

  transport.open('p1', ['p2']);

  await mesh.sendPublic('hello table');
  await mesh.sendPrivate('p2', 'secret');

  expect(transport.broadcasts).toEqual([
    {scope: 'public', data: 'hello table'},
  ]);
  expect(transport.sent).toEqual([
    {to: 'p2', data: {scope: 'private', recipient: 'p2', data: 'secret'}},
  ]);
});

test('delivers worker replay and public self echo to GameRoom format', () => {
  const transport = new MockRelayTransport();
  const mesh = new WorkerRelayMesh<string>(transport);
  const messages: Array<[unknown, boolean]> = [];
  mesh.on('message', (message, replay) => messages.push([message, replay]));

  transport.open('p1', ['p2']);
  transport.emit('message', 'p1', {scope: 'public', data: 'committed'}, false);
  transport.emit('message', 'p2', {scope: 'public', data: 'missed'}, true);
  transport.emit('message', 'p2', {scope: 'private', recipient: 'p3', data: 'not mine'}, false);
  transport.emit('message', 'p2', {scope: 'private', recipient: 'p1', data: 'mine'}, false);

  expect(messages).toEqual([
    [{type: 'public', sender: 'p1', data: 'committed'}, false],
    [{type: 'public', sender: 'p2', data: 'missed'}, true],
    [{type: 'private', sender: 'p2', recipient: 'p1', data: 'mine'}, false],
  ]);
});

test('locally commits public messages for older workers without public self echo', async () => {
  const transport = new MockRelayTransport();
  transport.publicSelfEcho = false;
  const mesh = new WorkerRelayMesh<string>(transport);
  const messages: Array<[unknown, boolean]> = [];
  mesh.on('message', (message, replay) => messages.push([message, replay]));

  transport.open('p1', ['p2']);

  await expect(mesh.sendPublic('legacy-worker')).resolves.toBe(true);
  await Promise.resolve();

  expect(messages).toEqual([
    [{type: 'public', sender: 'p1', data: 'legacy-worker'}, false],
  ]);
});

test('reports failed relay sends so GameRoom can retry instead of hanging', async () => {
  const transport = new MockRelayTransport();
  transport.failBroadcast = true;
  const mesh = new WorkerRelayMesh<string>(transport);
  transport.open('p1', ['p2']);

  await expect(mesh.sendPublic('not-sent')).resolves.toBe(false);
});
