import {
  __setWarmPlayerFactoryForTests,
  warmUpFirstShufflerPlayer,
  takeWarmFirstShufflerPlayer,
} from "./MentalPokerGameRoom";
import {Player} from "./secureMentalPoker";

// 用一个轻量假 Player 工厂替换真加密，只验证"预洗牌缓存"的簿记逻辑（不跑真 1024-bit 加密）。
function fakePlayerFactory() {
  const state = {calls: 0};
  // 不加返回类型注解：CRA 的 TSX 转换会把 `: Promise<Player>` 里的 <Player> 误当作 JSX。
  const factory = (_bits: number) => {
    state.calls += 1;
    // 只需要一个可辨识的占位对象；take 返回的应是同一个 promise。
    return Promise.resolve({__fake: state.calls} as unknown as Player);
  };
  return {factory, calls: () => state.calls};
}

afterEach(() => {
  __setWarmPlayerFactoryForTests(null);
});

test('没有预热时 take 返回 null（保持原有现算行为）', () => {
  const f = fakePlayerFactory();
  __setWarmPlayerFactoryForTests(f.factory); // 同时清空缓存
  expect(takeWarmFirstShufflerPlayer(1024)).toBeNull();
  expect(f.calls()).toBe(0); // take 不该触发生成
});

test('warm 之后 take 拿到同一个 promise，且是一次性消费', async () => {
  const f = fakePlayerFactory();
  __setWarmPlayerFactoryForTests(f.factory);

  warmUpFirstShufflerPlayer(1024);
  expect(f.calls()).toBe(1);

  // 重复 warm 同 bits 不该再生成第二份。
  warmUpFirstShufflerPlayer(1024);
  expect(f.calls()).toBe(1);

  const first = takeWarmFirstShufflerPlayer(1024);
  expect(first).not.toBeNull();
  await expect(first).resolves.toMatchObject({__fake: 1});

  // 用掉即失效：第二次 take 为 null。
  expect(takeWarmFirstShufflerPlayer(1024)).toBeNull();
});

test('bits 不匹配时 take 返回 null（调用方会现算正确 bits）', () => {
  const f = fakePlayerFactory();
  __setWarmPlayerFactoryForTests(f.factory);

  warmUpFirstShufflerPlayer(1024);
  expect(takeWarmFirstShufflerPlayer(2048)).toBeNull(); // 位数不同，不能复用
  // 原 1024 缓存仍在，可被正确 bits 取走。
  expect(takeWarmFirstShufflerPlayer(1024)).not.toBeNull();
});

test('undefined bits 归一化到默认位数，可被默认 warm 命中', () => {
  const f = fakePlayerFactory();
  __setWarmPlayerFactoryForTests(f.factory);

  warmUpFirstShufflerPlayer(); // 默认 bits
  expect(takeWarmFirstShufflerPlayer()).not.toBeNull(); // 同样默认 bits，命中
});
