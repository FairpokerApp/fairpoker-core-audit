import {SIGNED_EVENT_KIND} from "./fairness/eventSigning";
import {TranscriptSnapshot} from "./fairness/transcript";
import {deriveEncryptedShuffleStatus} from "./useEncryptedShuffleStatus";

function snapshot(events: Array<{type: string; round: number; at: number; payload?: Record<string, unknown>}>): TranscriptSnapshot<unknown> {
  return {
    version: 'fairpoker.transcript.v1',
    finalHash: 'sha256:test',
    entries: events.map((event, index) => ({
      index,
      previousHash: index ? `sha256:${index - 1}` : 'sha256:genesis',
      eventHash: `sha256:${index}`,
      recordedAt: new Date(event.at).toISOString(),
      transportSender: 'sender',
      scope: 'public' as const,
      signed: true,
      payloadHash: `sha256:payload-${index}`,
      wireEvent: {
        kind: SIGNED_EVENT_KIND,
        payload: {
          type: event.type,
          round: event.round,
          ...event.payload,
        },
        signerPeerId: 'sender',
        payloadHash: `sha256:payload-${index}`,
        signature: 'sig',
      },
    })),
  };
}

test('shows shuffle overlay from transcript start event before newRound exists', () => {
  const status = deriveEncryptedShuffleStatus(snapshot([
    {
      type: 'start',
      round: 2,
      at: 1_000,
      payload: {mentalPokerSettings: {participants: ['p2', 'p1']}},
    },
  ]), 1_100);

  expect(status.visible).toBe(true);
  expect(status.startedAtMs).toBe(1_000);
  expect(status.participants).toEqual(['p2', 'p1']);
});

test('keeps shuffle overlay visible briefly after deck finalized', () => {
  const status = deriveEncryptedShuffleStatus(snapshot([
    {
      type: 'start',
      round: 1,
      at: 1_000,
      payload: {mentalPokerSettings: {participants: ['p1', 'p2']}},
    },
    {type: 'deck/finalized', round: 1, at: 1_200},
  ]), 1_700);

  expect(status.visible).toBe(true);
  expect(status.participants).toEqual(['p1', 'p2']);
});

test('hides shuffle overlay after the proof window has passed', () => {
  const status = deriveEncryptedShuffleStatus(snapshot([
    {
      type: 'start',
      round: 1,
      at: 1_000,
      payload: {mentalPokerSettings: {participants: ['p1', 'p2']}},
    },
    {type: 'deck/finalized', round: 1, at: 1_200},
  ]), 3_000);

  expect(status.visible).toBe(false);
});

test('hides shuffle overlay when an unfinished shuffle stalls (e.g. peer dropped mid-shuffle)', () => {
  const status = deriveEncryptedShuffleStatus(snapshot([
    {
      type: 'start',
      round: 1,
      at: 1_000,
      payload: {mentalPokerSettings: {participants: ['p1', 'p2']}},
    },
    {type: 'deck/shuffle', round: 1, at: 1_200, payload: {player: 'p1', shuffleIndex: 0}},
    // p2 掉线：之后再也没有 shuffle / lock / finalized 事件流入。
  ]), 1_200 + 8_000 + 1);

  expect(status.visible).toBe(false);
});

test('keeps shuffle overlay visible while shuffle events keep arriving (slow but alive)', () => {
  const status = deriveEncryptedShuffleStatus(snapshot([
    {
      type: 'start',
      round: 1,
      at: 1_000,
      payload: {mentalPokerSettings: {participants: ['p1', 'p2']}},
    },
    {type: 'deck/shuffle', round: 1, at: 6_000, payload: {player: 'p1', shuffleIndex: 0}},
    {type: 'deck/shuffle', round: 1, at: 11_000, payload: {player: 'p2', shuffleIndex: 1}},
    // 距离 start 已 11 秒，但最后一个事件才过去 1 秒，洗牌仍在推进。
  ]), 12_000);

  expect(status.visible).toBe(true);
});
