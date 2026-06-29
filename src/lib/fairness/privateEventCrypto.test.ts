import {sealCardKey, openCardKey, CardKeyBinding} from "./privateEventCrypto";

async function generateRsaPair() {
  return window.crypto.subtle.generateKey(
    {name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'},
    true,
    ['encrypt', 'decrypt'],
  );
}

const binding: CardKeyBinding = {
  sender: 'alice',
  recipient: 'bob',
  round: 1,
  cardOffset: 5,
  handId: 'h1',
};

const key = {d: '12345678901234567890', n: '98765432109876543210'};

describe('private card-key sealing', () => {
  it('round-trips a sealed key for the right recipient and binding', async () => {
    const pair = await generateRsaPair();
    const sealed = await sealCardKey(key, binding, pair.publicKey);
    expect(typeof sealed).toBe('string');
    const opened = await openCardKey(sealed, binding, pair.privateKey);
    expect(opened).toEqual(key);
  }, 30000);

  it('rejects a binding mismatch (relay cannot redirect a sealed key)', async () => {
    const pair = await generateRsaPair();
    const sealed = await sealCardKey(key, binding, pair.publicKey);
    await expect(openCardKey(sealed, {...binding, cardOffset: 6}, pair.privateKey)).rejects.toThrow('binding mismatch');
    await expect(openCardKey(sealed, {...binding, recipient: 'carol'}, pair.privateKey)).rejects.toThrow('binding mismatch');
    await expect(openCardKey(sealed, {...binding, round: 2}, pair.privateKey)).rejects.toThrow('binding mismatch');
  }, 30000);

  it('cannot be opened by a different private key (relay cannot read it)', async () => {
    const pair = await generateRsaPair();
    const attacker = await generateRsaPair();
    const sealed = await sealCardKey(key, binding, pair.publicKey);
    await expect(openCardKey(sealed, binding, attacker.privateKey)).rejects.toThrow();
  }, 30000);
});
