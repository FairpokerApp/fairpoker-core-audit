import {verifyRunningClientCid} from "./clientCidVerification";
import {RuntimeCodeSource} from "./runtimeCodeSource";

const ipfs = (cid: string): RuntimeCodeSource => ({kind: 'ipfs', cid, label: 'l', detail: 'd', trusted: true});
const mirror: RuntimeCodeSource = {kind: 'web', label: 'l', detail: 'd', trusted: false};

describe('verifyRunningClientCid (B12: running bundle matches the pinned CID)', () => {
  it('verified when running CID matches the canonical Game client CID', () => {
    expect(verifyRunningClientCid(ipfs('bafyCANON'), 'bafyCANON')).toEqual({status: 'verified', cid: 'bafyCANON'});
  });

  it('mismatch when running from IPFS but a different CID is served', () => {
    expect(verifyRunningClientCid(ipfs('bafyEVIL'), 'bafyCANON')).toEqual({
      status: 'mismatch', runningCid: 'bafyEVIL', canonicalCid: 'bafyCANON',
    });
  });

  it('not-pinned when not loaded from an IPFS CID', () => {
    expect(verifyRunningClientCid(mirror, 'bafyCANON')).toEqual({status: 'not-pinned'});
  });

  it('unknown when the canonical release identity is not loaded yet', () => {
    expect(verifyRunningClientCid(ipfs('bafyCANON'), '')).toEqual({status: 'unknown'});
  });
});
