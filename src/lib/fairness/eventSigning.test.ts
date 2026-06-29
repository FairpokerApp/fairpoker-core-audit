import {
  createEventSigner,
  generateSigningIdentity,
  verifySignedGameEvent,
} from "./eventSigning";

describe('event signing', () => {
  test('signs and verifies a public event', async () => {
    const identity = await generateSigningIdentity();
    const signer = await createEventSigner(identity);

    const signed = await signer.sign({
      sender: identity.peerId,
      scope: 'public',
      payload: {
        type: 'action/bet',
        round: 1,
        amount: 10,
      },
    });

    await expect(verifySignedGameEvent(signed, identity.peerId)).resolves.toEqual({
      ok: true,
    });
  });

  test('rejects payload tampering', async () => {
    const identity = await generateSigningIdentity();
    const signer = await createEventSigner(identity);

    const signed = await signer.sign({
      sender: identity.peerId,
      scope: 'public',
      payload: {
        type: 'action/bet',
        round: 1,
        amount: 10,
      },
    });

    const tampered = {
      ...signed,
      payload: {
        ...signed.payload,
        amount: 999,
      },
    };

    await expect(verifySignedGameEvent(tampered, identity.peerId)).resolves.toMatchObject({
      ok: false,
    });
  });

  test('binds a stable per-session nonce that is signed and verifies', async () => {
    const identity = await generateSigningIdentity();
    const signer = await createEventSigner(identity);

    const first = await signer.sign({sender: identity.peerId, scope: 'public', payload: {type: 'action/fold', round: 1}});
    const second = await signer.sign({sender: identity.peerId, scope: 'public', payload: {type: 'action/fold', round: 2}});

    expect(typeof first.sessionNonce).toBe('string');
    expect(first.sessionNonce).toHaveLength(32);
    // Stable within one signer instance (one session)...
    expect(second.sessionNonce).toBe(first.sessionNonce);
    // ...and still part of the verified signature.
    await expect(verifySignedGameEvent(first, identity.peerId)).resolves.toEqual({ok: true});

    // Tampering with the bound nonce must break verification.
    const tampered = {...first, sessionNonce: 'f'.repeat(32)};
    await expect(verifySignedGameEvent(tampered, identity.peerId)).resolves.toMatchObject({ok: false});
  });

  test('different signer instances get different session nonces', async () => {
    const identity = await generateSigningIdentity();
    const signerA = await createEventSigner(identity);
    const signerB = await createEventSigner(identity);

    const a = await signerA.sign({sender: identity.peerId, scope: 'public', payload: {type: 'action/fold', round: 1}});
    const b = await signerB.sign({sender: identity.peerId, scope: 'public', payload: {type: 'action/fold', round: 1}});

    expect(a.sessionNonce).not.toBe(b.sessionNonce);
  });

  test('binds tableId into the signature when given a context', async () => {
    const identity = await generateSigningIdentity();
    const signer = await createEventSigner(identity, {tableId: 'table-xyz'});
    const signed = await signer.sign({sender: identity.peerId, scope: 'public', payload: {type: 'action/fold', round: 1}});
    expect(signed.tableId).toBe('table-xyz');
    await expect(verifySignedGameEvent(signed, identity.peerId)).resolves.toEqual({ok: true});
    // Tampering with the bound tableId must break verification.
    await expect(verifySignedGameEvent({...signed, tableId: 'table-other'}, identity.peerId)).resolves.toMatchObject({ok: false});
  });

  test('omits tableId when no context is given (backward compatible)', async () => {
    const identity = await generateSigningIdentity();
    const signer = await createEventSigner(identity);
    const signed = await signer.sign({sender: identity.peerId, scope: 'public', payload: {type: 'action/fold', round: 1}});
    expect(signed.tableId).toBeUndefined();
    await expect(verifySignedGameEvent(signed, identity.peerId)).resolves.toEqual({ok: true});
  });
});
