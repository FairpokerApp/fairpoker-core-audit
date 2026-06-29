import {getRuntimeCodeSource} from "./runtimeCodeSource";

test('detects path-style IPFS gateway URLs', () => {
  const source = getRuntimeCodeSource('https://ipfs.io/ipfs/QmRxJQFpbB4g5jk6ahSxUrqBbogYjVd5eJZb72ym1PgSTq/?gameRoomId=host');

  expect(source.kind).toBe('ipfs');
  expect(source.trusted).toBe(true);
  expect(source).toHaveProperty('cid', 'QmRxJQFpbB4g5jk6ahSxUrqBbogYjVd5eJZb72ym1PgSTq');
});

test('detects subdomain IPFS gateway URLs', () => {
  const source = getRuntimeCodeSource('https://bafybeia3hdi6bsoyprzahozgwrrnvjjottoejnwnqh27seawj6yixftc44.ipfs.dweb.link/');

  expect(source.kind).toBe('ipfs');
  expect(source.trusted).toBe(true);
});

test('marks ordinary web URLs as not the final fairness entry', () => {
  const source = getRuntimeCodeSource('https://example.com/');

  expect(source.kind).toBe('web');
  expect(source.trusted).toBe(false);
});
