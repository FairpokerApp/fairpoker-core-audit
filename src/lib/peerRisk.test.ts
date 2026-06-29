import {buildLocalPeerRiskReport, PeerProfileMap} from './peerRisk';
import {RelayPeerProfile} from './CloudflareRelayTransport';

function profile(peerId: string, overrides: Partial<RelayPeerProfile> = {}): RelayPeerProfile {
  return {
    peerId,
    connectedAt: 1,
    source: 'test',
    browser: 'Safari',
    os: 'macOS',
    device: 'desktop',
    platform: 'MacIntel',
    language: 'zh-CN',
    timezone: 'Asia/Tokyo',
    country: 'JP',
    screenBucket: '1900x1100',
    hardware: '8c-unknownm',
    ipSegment: '182.210.14.*',
    networkFingerprint: `net-${peerId}`,
    ipConfidence: 'high',
    clientFingerprint: `env-${peerId}`,
    ...overrides,
  };
}

test('local profile risk report resolves instead of staying pending when profile exists', () => {
  const profiles: PeerProfileMap = new Map([
    ['me', profile('me')],
    ['opponent', profile('opponent')],
  ]);

  const report = buildLocalPeerRiskReport('opponent', 'me', ['me', 'opponent'], profiles);

  expect(report.title).toBe('暂未发现明显风险');
  expect(report.score).toBe(12);
  expect(report.signals.map(signal => signal.label)).toEqual([
    '语言与时区一致',
    '屏幕与硬件档位接近',
  ]);
});

test('local profile risk report flags shared masked network and device environment', () => {
  const profiles: PeerProfileMap = new Map([
    ['me', profile('me', {networkFingerprint: 'net-same', clientFingerprint: 'env-same'})],
    ['opponent', profile('opponent', {networkFingerprint: 'net-same', clientFingerprint: 'env-same'})],
  ]);

  const report = buildLocalPeerRiskReport('opponent', 'me', ['me', 'opponent'], profiles);

  expect(report.level).toBe('high');
  expect(report.score).toBe(64);
  expect(report.signals.map(signal => signal.label)).toContain('与你处于相近网络');
  expect(report.signals.map(signal => signal.label)).toContain('设备环境高度相似');
});
