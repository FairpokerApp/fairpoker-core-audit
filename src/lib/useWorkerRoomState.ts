import {useEffect, useMemo, useState} from "react";
import {WorkerRoomPlayerState, WorkerRoomState} from "./CloudflareRelayTransport";

function latestRoomStateStore() {
  if (typeof window === 'undefined') {
    return new Map<string, WorkerRoomState>();
  }
  const fairPokerWindow = window as Window & {
    __fairPokerLatestRoomStates?: Map<string, WorkerRoomState>;
  };
  if (!fairPokerWindow.__fairPokerLatestRoomStates) {
    fairPokerWindow.__fairPokerLatestRoomStates = new Map();
  }
  return fairPokerWindow.__fairPokerLatestRoomStates;
}

function normalizePositiveInteger(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : 0;
}

function isLatestWorkerRoomState(existing: WorkerRoomState | undefined, next: WorkerRoomState) {
  if (!existing) {
    return true;
  }
  const existingSeq = normalizePositiveInteger(existing.latestEventSeq);
  const nextSeq = normalizePositiveInteger(next.latestEventSeq);
  if (nextSeq !== existingSeq) {
    return nextSeq > existingSeq;
  }
  const existingVersion = normalizePositiveInteger(existing.version);
  const nextVersion = normalizePositiveInteger(next.version);
  if (nextVersion !== existingVersion) {
    return nextVersion > existingVersion;
  }
  return normalizePositiveInteger(next.generatedAt) > normalizePositiveInteger(existing.generatedAt);
}

export function getLatestWorkerRoomState(roomId?: string) {
  const latestRoomStates = latestRoomStateStore();
  if (roomId) {
    return latestRoomStates.get(roomId) ?? null;
  }
  const states = Array.from(latestRoomStates.values());
  return states[states.length - 1] ?? null;
}

export function clearLatestWorkerRoomStatesForTest() {
  latestRoomStateStore().clear();
}

export function hasCurrentRoomRound(roomState: WorkerRoomState | null | undefined) {
  return Number.isSafeInteger(roomState?.currentRound) && (roomState?.currentRound ?? 0) > 0;
}

export function workerRoomHasLiveHand(roomState: WorkerRoomState | null | undefined) {
  return Boolean(hasCurrentRoomRound(roomState) && workerRoomTablePlayers(roomState).length);
}

function normalizePlayerOrder(players: string[]) {
  return Array.from(new Set(players.filter(Boolean)));
}

function workerRoomTableSeatSet(roomState: WorkerRoomState | null | undefined) {
  if (!roomState) {
    return new Set<string>();
  }
  const roomPlayers = new Map(roomState.players.map(player => [player.peerId, player]));
  const currentRound = roomState.currentRound ?? 0;
  const seatedPlayersInRound = roomState.currentPlayers.length > 0
    ? roomState.currentPlayers.filter(playerId => {
      const player = roomPlayers.get(playerId);
      if (!player) {
        return currentRound > 0;
      }
      return Boolean(
        player.status === 'active'
        && player.seated !== false
        && player.online !== false
        && player.connected !== false
      );
    })
    : roomState.players
      .filter(player => (
        player.seated
        && player.status === 'active'
        && player.online !== false
        && player.connected !== false
      ))
      .map(player => player.peerId);
  return new Set(normalizePlayerOrder(seatedPlayersInRound));
}

export function workerRoomTablePlayers(roomState: WorkerRoomState | null | undefined) {
  return Array.from(workerRoomTableSeatSet(roomState));
}

export function workerRoomSeatedPlayers(roomState: WorkerRoomState | null | undefined) {
  return workerRoomTablePlayers(roomState);
}

export function workerRoomRailPlayers(roomState: WorkerRoomState | null | undefined) {
  if (!roomState) {
    return [];
  }
  const tablePlayers = workerRoomTableSeatSet(roomState);
  return roomState.players.filter(player => (
    !tablePlayers.has(player.peerId)
    && (
      player.seated ||
      player.spectator
      || player.status === 'watching'
      || player.status === 'sittingOut'
      || player.status === 'timedOut'
      || player.status === 'offline'
    )
  ));
}

export function localTableIsBehindWorker(
  roomState: WorkerRoomState | null | undefined,
  localRound: number | undefined,
) {
  if (!roomState || !hasCurrentRoomRound(roomState)) {
    return false;
  }
  const workerRound = roomState.currentRound;
  return Boolean(workerRound && (localRound === undefined || workerRound > localRound));
}

export function useWorkerRoomState(roomId?: string) {
  const [roomState, setRoomState] = useState<WorkerRoomState | null>(() => roomId ? getLatestWorkerRoomState(roomId) : null);

  useEffect(() => {
    setRoomState(roomId ? getLatestWorkerRoomState(roomId) : null);
    const listener = (event: Event) => {
      const customEvent = event as CustomEvent<{roomState?: WorkerRoomState}>;
      const next = customEvent.detail?.roomState;
      if (!next?.roomId) {
        return;
      }
      const latestRoomStates = latestRoomStateStore();
      const existing = latestRoomStates.get(next.roomId);
      if (existing === next) {
        if (roomId && next.roomId === roomId) {
          setRoomState(next);
        }
        return;
      }
      if (!isLatestWorkerRoomState(existing, next)) {
        return;
      }
      latestRoomStates.set(next.roomId, next);
      if (roomId && next.roomId === roomId) {
        setRoomState(next);
      }
    };

    window.addEventListener('fairpoker:room-state', listener);
    return () => window.removeEventListener('fairpoker:room-state', listener);
  }, [roomId]);

  return roomState;
}

export function useWorkerPlayerState(playerId: string | undefined, roomId?: string): WorkerRoomPlayerState | undefined {
  const roomState = useWorkerRoomState(roomId);
  return useMemo(() => {
    if (!playerId || !roomState) {
      return undefined;
    }
    return roomState?.players.find(player => player.peerId === playerId);
  }, [playerId, roomState]);
}

export function workerConnectionStatus(player: WorkerRoomPlayerState | undefined): 'good' | 'warn' | 'offline' | undefined {
  if (!player) {
    return undefined;
  }
  if (!player.online || player.status === 'offline') {
    return 'offline';
  }
  if (player.status === 'timedOut' || player.status === 'sittingOut' || player.status === 'watching') {
    return 'warn';
  }
  return 'good';
}
