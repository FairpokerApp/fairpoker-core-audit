import CloudflareRelayTransport, {buildTokenSubprotocols, TOKEN_SUBPROTOCOL_PREFIX} from "./CloudflareRelayTransport";

describe('buildTokenSubprotocols (B11: relay token via WebSocket subprotocol, not URL)', () => {
  it('encodes the auth token as a single subprotocol', () => {
    expect(buildTokenSubprotocols('tok-abc_123')).toEqual([`${TOKEN_SUBPROTOCOL_PREFIX}tok-abc_123`]);
  });

  it('returns undefined when there is no token', () => {
    expect(buildTokenSubprotocols(undefined)).toBeUndefined();
    expect(buildTokenSubprotocols('')).toBeUndefined();
  });
});

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  closeCalled = false;
  private readonly handlers: Record<string, Array<(ev: any) => void>> = {};

  constructor(public url: string, public protocols?: string | string[]) {
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, cb: (ev: any) => void) {
    (this.handlers[type] ||= []).push(cb);
  }

  removeEventListener(type: string, cb: (ev: any) => void) {
    this.handlers[type] = (this.handlers[type] || []).filter(h => h !== cb);
  }

  send() {}

  close() {
    this.closeCalled = true;
    this.readyState = MockWebSocket.CLOSED;
    this.dispatch('close', {});
  }

  private dispatch(type: string, ev: any) {
    (this.handlers[type] || []).forEach(h => h(ev));
  }

  emitOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.dispatch('open', {});
  }

  emitMessage(data: unknown) {
    this.dispatch('message', { data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  emitClose(code?: number) {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatch('close', { code, wasClean: code === 1000 });
  }
}

describe('CloudflareRelayTransport auto-reconnect (disconnect resilience)', () => {
  const realWebSocket = (global as any).WebSocket;

  beforeEach(() => {
    MockWebSocket.instances = [];
    (global as any).WebSocket = MockWebSocket as unknown as typeof WebSocket;
    jest.useFakeTimers();
  });

  afterEach(() => {
    (global as any).WebSocket = realWebSocket;
    jest.useRealTimers();
  });

  it('reconnects with the same peerId after an unexpected close', () => {
    new CloudflareRelayTransport({
      serverUrl: 'https://relay.example/',
      roomId: 'room-aaaaaaaa',
      peerId: 'peer-aaaaaaaa',
      authToken: 'tok',
    });
    expect(MockWebSocket.instances).toHaveLength(1);
    const first = MockWebSocket.instances[0];
    first.emitOpen();
    first.emitMessage({ type: 'welcome', roomId: 'room-aaaaaaaa', peerId: 'peer-aaaaaaaa', peers: [] });

    first.emitClose();
    // Backoff: not reconnected synchronously.
    expect(MockWebSocket.instances).toHaveLength(1);

    jest.advanceTimersByTime(20000);
    expect(MockWebSocket.instances).toHaveLength(2);
    const second = MockWebSocket.instances[1];
    expect(new URL(second.url).searchParams.get('peerId')).toBe('peer-aaaaaaaa');
  });

  it('does not reconnect when the relay replaces the session (code 1000)', () => {
    // The worker closes a superseded socket with code 1000 ("Duplicate player
    // session replaced") when a newer session for the same peerId connects.
    // Reconnecting then would fight the newer session and flap both to offline.
    new CloudflareRelayTransport({
      serverUrl: 'https://relay.example/',
      roomId: 'room-eeeeeeee',
      peerId: 'peer-eeeeeeee',
    });
    const first = MockWebSocket.instances[0];
    first.emitOpen();
    first.emitClose(1000);

    jest.advanceTimersByTime(60000);

    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('does not reconnect after an intentional close()', () => {
    const transport = new CloudflareRelayTransport({
      serverUrl: 'https://relay.example/',
      roomId: 'room-bbbbbbbb',
      peerId: 'peer-bbbbbbbb',
    });
    MockWebSocket.instances[0].emitOpen();

    transport.close();
    jest.advanceTimersByTime(60000);

    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('requests replay from the last seen seq on reconnect', () => {
    new CloudflareRelayTransport({
      serverUrl: 'https://relay.example/',
      roomId: 'room-cccccccc',
      peerId: 'peer-cccccccc',
    });
    const first = MockWebSocket.instances[0];
    first.emitOpen();
    first.emitMessage({ type: 'welcome', roomId: 'room-cccccccc', peerId: 'peer-cccccccc', peers: [] });
    first.emitMessage({ type: 'message', from: 'peer-dddddddd', seq: 7, data: { scope: 'public', data: {} } });

    first.emitClose();
    jest.advanceTimersByTime(20000);

    const second = MockWebSocket.instances[1];
    expect(new URL(second.url).searchParams.get('sinceSeq')).toBe('7');
  });

  it('stops reconnecting after many consecutive welcome-less failures and surfaces an error', () => {
    // Guards against the Chrome-149 silent-handshake-failure flapping: if the
    // upgrade never succeeds, we must stop after a bounded number of attempts
    // rather than burning the console forever and making the peer look offline
    // to everyone else in the room.
    const transport = new CloudflareRelayTransport({
      serverUrl: 'https://relay.example/',
      roomId: 'room-ffffffff',
      peerId: 'peer-ffffffff',
    });
    const errors: unknown[] = [];
    transport.on('error', (err) => errors.push(err));

    for (let i = 0; i < 100; i += 1) {
      const last = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      last.emitClose(); // no welcome, abnormal close
      jest.advanceTimersByTime(20000);
    }

    expect(MockWebSocket.instances.length).toBeLessThanOrEqual(21);
    expect(errors.some(e => String(e).includes('giving up'))).toBe(true);
  });
});
