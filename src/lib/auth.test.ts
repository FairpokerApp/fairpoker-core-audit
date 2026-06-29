import {deriveAuthSecret, register} from "./auth";

describe('deriveAuthSecret (B01: the raw password never leaves the browser)', () => {
  it('is deterministic for the same username + password', async () => {
    const a = await deriveAuthSecret('alice', 'correct-horse-1');
    const b = await deriveAuthSecret('alice', 'correct-horse-1');
    expect(a).toBe(b);
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(20);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding
  }, 30000);

  it('differs for a different password or username', async () => {
    const base = await deriveAuthSecret('alice', 'pw-one-xyz');
    expect(await deriveAuthSecret('alice', 'pw-two-xyz')).not.toBe(base);
    expect(await deriveAuthSecret('bob', 'pw-one-xyz')).not.toBe(base);
  }, 30000);

  it('is not the raw password', async () => {
    expect(await deriveAuthSecret('alice', 'pw-secret-123')).not.toBe('pw-secret-123');
  }, 30000);
});

describe('register (B01: sends authSecret, never the raw password)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    (global as {fetch: typeof fetch}).fetch = realFetch;
    localStorage.clear();
    sessionStorage.clear();
  });

  it('puts authSecret (not password) into the request body', async () => {
    const fetchMock = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        session: {kind: 'registered', userId: 'u1', username: 'tester1', token: 'tok', expiresAt: Date.now() + 1_000_000},
      }),
    }));
    (global as {fetch: unknown}).fetch = fetchMock;

    await register('tester1', 'password123');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(String(init?.body));
    expect(typeof body.authSecret).toBe('string');
    expect(body.authSecret.length).toBeGreaterThan(20);
    expect(body.password).toBeUndefined();
    expect(body.authSecret).not.toBe('password123');
    // the encrypted vault is still sent (server stores ciphertext it cannot open)
    expect(body.vault).toBeDefined();
  }, 60000);
});
