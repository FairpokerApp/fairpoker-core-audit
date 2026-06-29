import {canonicalHandHash, publicEventSignaturesForRound, evaluateHandConsensus} from "./handConsensus";
import {SIGNED_EVENT_KIND} from "./eventSigning";

function entry(scope: 'public' | 'private', round: number, signature: string) {
  return {
    scope,
    wireEvent: {kind: SIGNED_EVENT_KIND, scope, payload: {round}, signature},
  };
}

describe('canonicalHandHash (B09/D05: receiver-independent hand record)', () => {
  it('is identical regardless of receive order', async () => {
    const a = [entry('public', 1, 'sigA'), entry('public', 1, 'sigB'), entry('public', 1, 'sigC')];
    const b = [entry('public', 1, 'sigC'), entry('public', 1, 'sigA'), entry('public', 1, 'sigB')];
    expect(await canonicalHandHash(a, 1)).toBe(await canonicalHandHash(b, 1));
  });

  it('excludes private events and other rounds (independent of hole cards / order)', async () => {
    const withNoise = [
      entry('public', 1, 'sigA'),
      entry('private', 1, 'sigPriv'), // private hole-card delivery — excluded
      entry('public', 2, 'sigOther'), // a different hand — excluded
      entry('public', 1, 'sigB'),
    ];
    const onlyRound1Public = [entry('public', 1, 'sigB'), entry('public', 1, 'sigA')];
    expect(await canonicalHandHash(withNoise, 1)).toBe(await canonicalHandHash(onlyRound1Public, 1));
  });

  it('differs when the set of public events differs (divergent record detected)', async () => {
    const honest = [entry('public', 1, 'sigA'), entry('public', 1, 'sigB')];
    const tampered = [entry('public', 1, 'sigA'), entry('public', 1, 'sigX')];
    expect(await canonicalHandHash(honest, 1)).not.toBe(await canonicalHandHash(tampered, 1));
  });

  it('collects sorted public signatures for the round', () => {
    const entries = [entry('public', 1, 'z'), entry('public', 1, 'a'), entry('private', 1, 'p'), entry('public', 2, 'q')];
    expect(publicEventSignaturesForRound(entries, 1)).toEqual(['a', 'z']);
  });
});

describe('evaluateHandConsensus', () => {
  it('is pending with no peer receipts', () => {
    expect(evaluateHandConsensus(1, 'h', []).status).toBe('pending');
  });

  it('agrees when all peer receipts match', () => {
    const result = evaluateHandConsensus(1, 'hash1', [{signer: 'bob', handHash: 'hash1'}, {signer: 'carol', handHash: 'hash1'}]);
    expect(result).toMatchObject({status: 'agreed', round: 1, handHash: 'hash1'});
  });

  it('flags divergence with the conflicting signer', () => {
    const result = evaluateHandConsensus(1, 'hash1', [{signer: 'bob', handHash: 'hash1'}, {signer: 'mallory', handHash: 'EVIL'}]);
    expect(result.status).toBe('diverged');
    if (result.status === 'diverged') {
      expect(result.conflicts).toEqual([{signer: 'mallory', handHash: 'EVIL'}]);
    }
  });
});
