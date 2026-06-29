import React from 'react';
import {act, render, screen} from '@testing-library/react';
import {WorkerRoomState} from "./CloudflareRelayTransport";
import {
  clearLatestWorkerRoomStatesForTest,
  getLatestWorkerRoomState,
  useWorkerRoomState,
  workerRoomRailPlayers,
  workerRoomSeatedPlayers,
} from "./useWorkerRoomState";

function roomState(overrides: Partial<WorkerRoomState> = {}): WorkerRoomState {
  return {
    version: 1,
    source: 'cloudflare-worker',
    roomId: 'table-test',
    generatedAt: 1,
    viewerPeerId: 'me',
    latestEventSeq: 1,
    currentRound: 1,
    currentPlayers: ['me', 'other'],
    currentTurn: null,
    players: [
      {peerId: 'me', online: false, connected: false, seated: false, status: 'offline'},
      {peerId: 'other', online: true, connected: true, seated: true, status: 'active'},
    ],
    activePlayerCount: 1,
    onlineCount: 1,
    roomValid: true,
    playable: false,
    reason: 'waiting-for-online-player',
    ...overrides,
  };
}

beforeEach(() => {
  clearLatestWorkerRoomStatesForTest();
});

test('splits worker seated players from rail players', () => {
  const state = roomState({
    currentPlayers: ['p1', 'p2'],
    players: [
      {peerId: 'p1', online: true, connected: true, seated: true, status: 'active'},
      {peerId: 'p2', online: true, connected: true, seated: true, status: 'active'},
      {peerId: 'p3', online: true, connected: true, seated: false, status: 'watching', spectator: true},
      {peerId: 'p4', online: true, connected: true, seated: true, status: 'active'},
    ],
  });

  expect(workerRoomSeatedPlayers(state)).toEqual(['p1', 'p2']);
  expect(workerRoomRailPlayers(state).map(player => player.peerId)).toEqual(['p3', 'p4']);
});

test('moves offline current hand players to the rail', () => {
  const state = roomState({
    currentPlayers: ['p1', 'p2'],
    players: [
      {peerId: 'p1', online: true, connected: true, seated: true, status: 'active'},
      {peerId: 'p2', online: false, connected: false, seated: false, status: 'offline'},
      {peerId: 'p3', online: true, connected: true, seated: false, status: 'watching', spectator: true},
    ],
  });

  expect(workerRoomSeatedPlayers(state)).toEqual(['p1']);
  expect(workerRoomRailPlayers(state).map(player => player.peerId)).toEqual(['p2', 'p3']);
});

test('moves timed-out current hand players to the rail', () => {
  const state = roomState({
    currentPlayers: ['p1', 'p2'],
    players: [
      {peerId: 'p1', online: true, connected: true, seated: false, status: 'timedOut', timedOut: true},
      {peerId: 'p2', online: true, connected: true, seated: true, status: 'active'},
    ],
  });

  expect(workerRoomSeatedPlayers(state)).toEqual(['p2']);
  expect(workerRoomRailPlayers(state).map(player => player.peerId)).toEqual(['p1']);
});

test('keeps seated lobby players out of the rail before a hand starts', () => {
  const state = roomState({
    currentRound: null,
    currentPlayers: [],
    players: [
      {peerId: 'p1', online: true, connected: true, seated: true, status: 'active'},
      {peerId: 'p2', online: true, connected: true, seated: true, status: 'active'},
      {peerId: 'p3', online: true, connected: true, seated: false, status: 'watching', spectator: true},
    ],
  });

  expect(workerRoomSeatedPlayers(state)).toEqual(['p1', 'p2']);
  expect(workerRoomRailPlayers(state).map(player => player.peerId)).toEqual(['p3']);
});

test('keeps active current-hand IDs even if player details are temporarily absent', () => {
  const state = roomState({
    currentRound: 2,
    currentPlayers: ['p1', 'p_unknown'],
    players: [
      {peerId: 'p1', online: true, connected: true, seated: true, status: 'active'},
      {peerId: 'p2', online: true, connected: true, seated: false, status: 'watching', spectator: true},
    ],
  });

  expect(workerRoomSeatedPlayers(state)).toEqual(['p1', 'p_unknown']);
  expect(workerRoomRailPlayers(state).map(player => player.peerId)).toEqual(['p2']);
});

test('stores only room state published by the worker', () => {
  function RoomStateProbe() {
    useWorkerRoomState('table-test');
    return null;
  }

  render(React.createElement(RoomStateProbe));
  const workerState = roomState({
    players: [
      {peerId: 'me', online: true, connected: true, seated: false, status: 'watching', spectator: true},
      {peerId: 'other', online: true, connected: true, seated: true, status: 'active'},
    ],
  });

  act(() => {
    window.dispatchEvent(new CustomEvent('fairpoker:room-state', {
      detail: { roomState: workerState },
    }));
  });

  const me = getLatestWorkerRoomState('table-test')?.players.find(player => player.peerId === 'me');
  expect(me).toEqual(expect.objectContaining({
    online: true,
    connected: true,
    seated: false,
    status: 'watching',
    spectator: true,
  }));
  expect(getLatestWorkerRoomState('table-test')?.playable).toBe(false);
});

test('reads room state that arrived before the hook mounted', () => {
  const workerState = roomState({
    players: [
      {peerId: 'me', online: true, connected: true, seated: false, status: 'watching', spectator: true},
      {peerId: 'other', online: true, connected: true, seated: true, status: 'active'},
    ],
  });
  (window as Window & {
    __fairPokerLatestRoomStates?: Map<string, WorkerRoomState>;
  }).__fairPokerLatestRoomStates = new Map([[workerState.roomId, workerState]]);

  function RoomStateProbe() {
    const state = useWorkerRoomState('table-test');
    return React.createElement('div', {'data-testid': 'room-state'}, state?.players.length ?? 0);
  }

  render(React.createElement(RoomStateProbe));

  expect(screen.getByTestId('room-state')).toHaveTextContent('2');
});

test('updates the hook when the transport pre-stores the same room state object', () => {
  const initialState = roomState({
    currentRound: null,
    currentPlayers: [],
    players: [
      {peerId: 'host', online: true, connected: true, seated: true, status: 'active'},
    ],
    activePlayerCount: 1,
    playable: false,
  });
  const nextState = roomState({
    currentRound: null,
    currentPlayers: [],
    generatedAt: 2,
    players: [
      {peerId: 'guest', online: true, connected: true, seated: true, status: 'active'},
      {peerId: 'host', online: true, connected: true, seated: true, status: 'active'},
    ],
    activePlayerCount: 2,
    playable: true,
  });
  (window as Window & {
    __fairPokerLatestRoomStates?: Map<string, WorkerRoomState>;
  }).__fairPokerLatestRoomStates = new Map([[initialState.roomId, initialState]]);

  function RoomStateProbe() {
    const state = useWorkerRoomState('table-test');
    return React.createElement('div', {'data-testid': 'active-count'}, state?.activePlayerCount ?? 0);
  }

  render(React.createElement(RoomStateProbe));
  expect(screen.getByTestId('active-count')).toHaveTextContent('1');

  act(() => {
    (window as Window & {
      __fairPokerLatestRoomStates?: Map<string, WorkerRoomState>;
    }).__fairPokerLatestRoomStates?.set(nextState.roomId, nextState);
    window.dispatchEvent(new CustomEvent('fairpoker:room-state', {
      detail: { roomState: nextState },
    }));
  });

  expect(screen.getByTestId('active-count')).toHaveTextContent('2');
});

test('ignores stale worker states based on event sequence', () => {
  const oldState = roomState({
    latestEventSeq: 10,
    generatedAt: 10_000,
    players: [
      {peerId: 'me', online: true, connected: true, seated: true, status: 'active'},
    {peerId: 'other', online: true, connected: true, seated: true, status: 'active'},
    ],
    currentRound: 5,
  });
  const freshState = roomState({
    latestEventSeq: 11,
    generatedAt: 11_000,
    players: [
      {peerId: 'me', online: true, connected: true, seated: true, status: 'active'},
      {peerId: 'other', online: true, connected: true, seated: true, status: 'active'},
      {peerId: 'joiner', online: true, connected: true, seated: false, status: 'watching'},
    ],
    currentRound: 6,
  });

  function RoomStateProbe() {
    useWorkerRoomState('table-test');
    return null;
  }

  render(React.createElement(RoomStateProbe));

  act(() => {
    window.dispatchEvent(new CustomEvent('fairpoker:room-state', {
      detail: { roomState: freshState },
    }));
    window.dispatchEvent(new CustomEvent('fairpoker:room-state', {
      detail: { roomState: oldState },
    }));
  });

  const latestState = getLatestWorkerRoomState('table-test');
  expect(latestState?.currentRound).toBe(6);
  expect(latestState?.latestEventSeq).toBe(11);
  expect(workerRoomRailPlayers(latestState).map(player => player.peerId)).toEqual(['joiner']);
});

test('keeps per-room canonical state and ignores older updates from another room', () => {
  const roomA: Partial<WorkerRoomState> = {
    roomId: 'table-A',
    latestEventSeq: 20,
    generatedAt: 20_000,
    players: [{peerId: 'a1', online: true, connected: true, seated: true, status: 'active'}],
    currentPlayers: ['a1'],
    currentRound: 2,
  };
  const roomB: Partial<WorkerRoomState> = {
    roomId: 'table-B',
    latestEventSeq: 50,
    generatedAt: 50_000,
    players: [{peerId: 'b1', online: true, connected: true, seated: true, status: 'active'}],
    currentPlayers: ['b1'],
    currentRound: 1,
  };

  const staleFromA: Partial<WorkerRoomState> = {
    roomId: 'table-A',
    latestEventSeq: 10,
    generatedAt: 10_000,
    players: [{peerId: 'old', online: true, connected: true, seated: true, status: 'active'}],
    currentPlayers: ['old'],
    currentRound: 1,
  };
  function RoomStateProbe() {
    useWorkerRoomState('table-A');
    return null;
  }

  render(React.createElement(RoomStateProbe));

  act(() => {
    window.dispatchEvent(new CustomEvent('fairpoker:room-state', {
      detail: {roomState: roomState(roomB)},
    }));
    window.dispatchEvent(new CustomEvent('fairpoker:room-state', {
      detail: {roomState: roomState({...roomA})},
    }));
    window.dispatchEvent(new CustomEvent('fairpoker:room-state', {
      detail: {
        roomState: roomState({
          ...staleFromA as Partial<WorkerRoomState>,
          roomId: 'table-A',
        }),
      },
    }));
  });

  const tableAState = getLatestWorkerRoomState('table-A');
  expect(tableAState?.roomId).toBe('table-A');
  expect(tableAState?.players[0].peerId).toBe('a1');
  expect(tableAState?.currentRound).toBe(2);
  expect(getLatestWorkerRoomState('table-B')?.players[0].peerId).toBe('b1');
});

test('compares version before generatedAt when sequence is equal', () => {
  const stale: Partial<WorkerRoomState> = {
    roomId: 'table-test',
    latestEventSeq: 7,
    version: 1,
    generatedAt: 5_000,
    players: [{peerId: 'old', online: true, connected: true, seated: true, status: 'active'}],
  };
  const fresh: Partial<WorkerRoomState> = {
    roomId: 'table-test',
    latestEventSeq: 7,
    version: 2,
    generatedAt: 3_000,
    players: [{peerId: 'new', online: true, connected: true, seated: true, status: 'active'}],
  };
  function RoomStateProbe() {
    useWorkerRoomState('table-test');
    return null;
  }
  render(React.createElement(RoomStateProbe));

  act(() => {
    window.dispatchEvent(new CustomEvent('fairpoker:room-state', {
      detail: {roomState: roomState(fresh)},
    }));
    window.dispatchEvent(new CustomEvent('fairpoker:room-state', {
      detail: {roomState: roomState(stale)},
    }));
  });

  const latest = getLatestWorkerRoomState('table-test');
  expect(latest?.version).toBe(2);
  expect(latest?.players[0].peerId).toBe('new');
});
