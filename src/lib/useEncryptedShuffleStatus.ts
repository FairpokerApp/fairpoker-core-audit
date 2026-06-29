import {useEffect, useMemo, useState} from "react";
import {SIGNED_EVENT_KIND, SignedGameEvent} from "./fairness/eventSigning";
import {TranscriptEntry, TranscriptSnapshot} from "./fairness/transcript";
import {TexasHoldem} from "./setup";

type ShuffleProtocolPayload = {
  type?: string;
  round?: number;
  player?: string;
  shuffleIndex?: number;
  lockIndex?: number;
  mentalPokerSettings?: {
    participants?: string[];
    alice?: string;
    bob?: string;
  };
};

export type EncryptedShuffleStatus = {
  visible: boolean;
  startedAtMs: number | null;
  round: number | null;
  participants: string[];
};

const MIN_VISIBLE_MS = 1800;
const COMPLETED_HOLD_MS = 900;
// 洗牌进行中，如果超过这段时间都没有任何新的洗牌事件流入，就认定这一手已经中断
// （对手掉线 / 网络断开 / 协议卡住），自动隐藏动画，避免它永远停在屏幕上。
const STALL_TIMEOUT_MS = 8000;
// 终极兜底：任何情况下，一次"尚未完成"的洗牌动画最多显示这么久。
const MAX_VISIBLE_MS = 60000;

function getPayload(entry: TranscriptEntry<unknown>): ShuffleProtocolPayload | null {
  const wireEvent = entry.wireEvent as ShuffleProtocolPayload | SignedGameEvent<ShuffleProtocolPayload>;
  if (!wireEvent || typeof wireEvent !== 'object') {
    return null;
  }
  if ((wireEvent as SignedGameEvent<ShuffleProtocolPayload>).kind === SIGNED_EVENT_KIND) {
    return (wireEvent as SignedGameEvent<ShuffleProtocolPayload>).payload;
  }
  return wireEvent as ShuffleProtocolPayload;
}

function uniqueParticipants(payload: ShuffleProtocolPayload | null) {
  const participants: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === 'string' && value && !participants.includes(value)) {
      participants.push(value);
    }
  };
  payload?.mentalPokerSettings?.participants?.forEach(add);
  add(payload?.mentalPokerSettings?.alice);
  add(payload?.mentalPokerSettings?.bob);
  return participants;
}

export function deriveEncryptedShuffleStatus(
  transcript: TranscriptSnapshot<unknown> | null,
  nowMs: number,
): EncryptedShuffleStatus {
  const roundStates = new Map<number, {
    round: number;
    participants: string[];
    startedAtMs: number;
    lastEventAtMs: number;
    finalizedAtMs: number | null;
  }>();

  for (const entry of transcript?.entries ?? []) {
    const payload = getPayload(entry);
    if (!payload?.round || typeof payload.type !== 'string') {
      continue;
    }
    if (
      payload.type !== 'start'
      && payload.type !== 'deck/shuffle'
      && payload.type !== 'deck/lock'
      && payload.type !== 'deck/finalized'
    ) {
      continue;
    }
    const recordedAtMs = Date.parse(entry.recordedAt);
    if (!Number.isFinite(recordedAtMs)) {
      continue;
    }
    const existing = roundStates.get(payload.round);
    const next = existing ?? {
      round: payload.round,
      participants: [],
      startedAtMs: recordedAtMs,
      lastEventAtMs: recordedAtMs,
      finalizedAtMs: null,
    };
    next.startedAtMs = Math.min(next.startedAtMs, recordedAtMs);
    next.lastEventAtMs = Math.max(next.lastEventAtMs, recordedAtMs);
    const participants = uniqueParticipants(payload);
    if (participants.length) {
      next.participants = participants;
    }
    if (payload.type === 'deck/finalized') {
      next.finalizedAtMs = recordedAtMs;
    }
    roundStates.set(payload.round, next);
  }

  const latest = Array.from(roundStates.values())
    .filter(state => state.participants.length > 0)
    .sort((a, b) => b.round - a.round || b.startedAtMs - a.startedAtMs)[0];

  if (!latest) {
    return {visible: false, startedAtMs: null, round: null, participants: []};
  }

  const visibleUntil = latest.finalizedAtMs === null
    ? Math.min(
        latest.startedAtMs + MAX_VISIBLE_MS,
        Math.max(latest.startedAtMs + MIN_VISIBLE_MS, latest.lastEventAtMs + STALL_TIMEOUT_MS),
      )
    : Math.max(latest.startedAtMs + MIN_VISIBLE_MS, latest.finalizedAtMs + COMPLETED_HOLD_MS);

  if (nowMs > visibleUntil) {
    return {visible: false, startedAtMs: null, round: latest.round, participants: latest.participants};
  }

  return {
    visible: true,
    startedAtMs: latest.startedAtMs,
    round: latest.round,
    participants: latest.participants,
  };
}

export function useEncryptedShuffleStatus(): EncryptedShuffleStatus {
  const [transcript, setTranscript] = useState<TranscriptSnapshot<unknown> | null>(
    () => TexasHoldem?.getTranscript?.() ?? null,
  );
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const sync = () => {
      setTranscript(TexasHoldem?.getTranscript?.() ?? null);
      setNowMs(Date.now());
    };
    sync();
    TexasHoldem?.listener.on('transcript', sync);
    return () => {
      TexasHoldem?.listener.off('transcript', sync);
    };
  }, []);

  const status = useMemo(() => deriveEncryptedShuffleStatus(transcript, nowMs), [nowMs, transcript]);

  useEffect(() => {
    if (!status.visible) {
      return;
    }
    const timer = window.setTimeout(() => setNowMs(Date.now()), 250);
    return () => window.clearTimeout(timer);
  }, [nowMs, status.visible]);

  return status;
}
