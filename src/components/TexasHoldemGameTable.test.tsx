import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import TexasHoldemGameTable from "./TexasHoldemGameTable";
import useTexasHoldem from "../lib/texas-holdem/useTexasHoldem";
import {useWorkerRoomState} from "../lib/useWorkerRoomState";
import {WorkerRoomState} from "../lib/CloudflareRelayTransport";
import {reduceTexasHoldem, ReducerEvent} from "../lib/texas-holdem/texasHoldemReducer";

jest.mock('../lib/setup');
jest.mock('../lib/texas-holdem/useTexasHoldem');
jest.mock('../lib/useWorkerRoomState', () => {
  const actual = jest.requireActual('../lib/useWorkerRoomState');
  return {
    ...actual,
    useWorkerRoomState: jest.fn(),
  };
});
jest.mock('../lib/useChatRoom', () => () => ({
  names: new Map([['p1', 'Alice'], ['p2', 'Bob']]),
  setMyName: jest.fn(),
  messages: [],
  sendMessage: jest.fn(),
}));
jest.mock('../lib/texas-holdem/useEventLogs', () => () => []);

const mockUseTexasHoldem = useTexasHoldem as jest.MockedFunction<typeof useTexasHoldem>;
const mockUseWorkerRoomState = useWorkerRoomState as jest.MockedFunction<typeof useWorkerRoomState>;

function workerRoomState(overrides: Partial<WorkerRoomState> = {}): WorkerRoomState {
  return {
    version: 1,
    source: 'cloudflare-worker',
    roomId: 'table-test',
    generatedAt: Date.now(),
    viewerPeerId: 'p1',
    latestEventSeq: 1,
    currentRound: 1,
    currentPlayers: ['p1', 'p2'],
    currentTurn: null,
    players: [
      {peerId: 'p1', online: true, connected: true, seated: true, status: 'active'},
      {peerId: 'p2', online: true, connected: true, seated: true, status: 'active'},
    ],
    activePlayerCount: 2,
    onlineCount: 2,
    roomValid: true,
    playable: true,
    reason: 'ready',
    ...overrides,
  };
}

function state(overrides = {}) {
  return {
    peerState: 'PeerServerConnected' as const,
    playerId: 'p1',
    members: ['p1', 'p2'],
    round: 1,
    currentRoundFinished: false,
    players: ['p1', 'p2'],
    potAmount: 0,
    hole: undefined,
    holesPerPlayer: undefined,
    board: [],
    whoseTurnAndCallAmount: null,
    smallBlind: undefined,
    bigBlind: undefined,
    button: undefined,
    startGame: jest.fn(),
    bankrolls: new Map([['p1', 100], ['p2', 100]]),
    scoreBoard: new Map([['p1', 0], ['p2', 0]]),
    handScoreBoard: new Map([['p1', 0], ['p2', 0]]),
    totalDebt: new Map(),
    myBetAmount: undefined,
    lastWinningResult: undefined,
    actionsDone: null,
    roundSettings: {initialFundAmount: 100},
    handPause: null,
    seriesProgress: {current: 1, total: 10, complete: false},
    canStartGame: jest.fn(() => true),
    actions: {
      fireBet: jest.fn(),
      fireFold: jest.fn(),
      sitOut: jest.fn(),
      returnToTable: jest.fn(),
      rejoinActiveHand: jest.fn(),
      openRegistration: jest.fn(),
      voteToVoidHand: jest.fn(),
    },
    ...overrides,
  };
}

beforeEach(() => {
  mockUseTexasHoldem.mockReturnValue(state() as unknown as ReturnType<typeof useTexasHoldem>);
  mockUseWorkerRoomState.mockReturnValue(workerRoomState());
});

test('rendering does not crash', () => {
  render(<TexasHoldemGameTable />);
});

test('shows return-to-table prompt when worker says player is sitting out', () => {
  const returnToTable = jest.fn();
  mockUseWorkerRoomState.mockReturnValue(workerRoomState({
    players: [
      {peerId: 'p1', online: true, connected: true, seated: false, status: 'sittingOut', sittingOut: true},
      {peerId: 'p2', online: true, connected: true, seated: true, status: 'active'},
    ],
    activePlayerCount: 1,
    playable: false,
    reason: 'waiting-for-seated-player',
  }));
  mockUseTexasHoldem.mockReturnValue(state({
    // A player who is sitting out is, by definition, not in a live local hand.
    round: undefined,
    currentRoundFinished: true,
    actions: {
      fireBet: jest.fn(),
      fireFold: jest.fn(),
      sitOut: jest.fn(),
      returnToTable,
      rejoinActiveHand: (round?: number | null) => returnToTable(round),
    },
  }) as unknown as ReturnType<typeof useTexasHoldem>);

  render(<TexasHoldemGameTable />);

  expect(screen.getByTestId('seat-recovery-panel')).toHaveTextContent('你已暂离牌桌');
  expect(screen.getByTestId('seat-recovery-panel')).toHaveTextContent('请重新坐下，等待其他人入座');
  fireEvent.click(screen.getByTestId('return-to-table-button'));
  expect(returnToTable).toHaveBeenCalledTimes(1);
});

test('shows a clear timeout prompt and returns with the worker round', async () => {
  const returnToTable = jest.fn().mockResolvedValue(undefined);
  mockUseWorkerRoomState.mockReturnValue(workerRoomState({
    currentRound: 7,
    players: [
      {peerId: 'p1', online: true, connected: true, seated: false, status: 'timedOut', timedOut: true},
      {peerId: 'p2', online: true, connected: true, seated: true, status: 'active'},
    ],
    activePlayerCount: 1,
    playable: false,
    reason: 'waiting-for-seated-player',
  }));
  mockUseTexasHoldem.mockReturnValue(state({
    round: undefined,
    currentRoundFinished: true,
    actions: {
      fireBet: jest.fn(),
      fireFold: jest.fn(),
      sitOut: jest.fn(),
      returnToTable,
      rejoinActiveHand: (round?: number | null) => returnToTable(round),
    },
  }) as unknown as ReturnType<typeof useTexasHoldem>);

  render(<TexasHoldemGameTable />);

  expect(screen.getByTestId('seat-recovery-panel')).toHaveTextContent('操作超时');
  expect(screen.getByTestId('seat-recovery-panel')).toHaveTextContent('本局已自动弃牌');
  expect(screen.getByTestId('return-to-table-button')).toHaveTextContent('重新坐下');
  fireEvent.click(screen.getByTestId('return-to-table-button'));
  await waitFor(() => expect(screen.getByTestId('seat-recovery-panel')).toHaveTextContent('正在等待开局'));
  await waitFor(() => expect(returnToTable).toHaveBeenCalledWith(7));
});

test('keeps the local player on the table during an active hand even if worker details are temporarily missing', () => {
  const returnToTable = jest.fn();
  mockUseWorkerRoomState.mockReturnValue(workerRoomState({
    currentRound: 2,
    currentPlayers: ['p1', 'p2'],
    players: [
      {peerId: 'p2', online: true, connected: true, seated: true, status: 'active'},
    ],
    activePlayerCount: 2,
    onlineCount: 2,
    playable: true,
    reason: 'ready',
  }));
  mockUseTexasHoldem.mockReturnValue(state({
    round: 2,
    players: ['p1', 'p2'],
    currentRoundFinished: false,
    whoseTurnAndCallAmount: {whoseTurn: 'p1', callAmount: 10},
    hole: [{suit: 'Spade', rank: 'A'}, {suit: 'Heart', rank: 'K'}],
    actions: {
      fireBet: jest.fn(),
      fireFold: jest.fn(),
      sitOut: jest.fn(),
      returnToTable,
      rejoinActiveHand: (round?: number | null) => returnToTable(round),
    },
  }) as unknown as ReturnType<typeof useTexasHoldem>);

  render(<TexasHoldemGameTable />);

  expect(screen.queryByTestId('seat-recovery-panel')).not.toBeInTheDocument();
  expect(screen.getByTestId('check-or-call-action-button')).toBeInTheDocument();
  expect(screen.getByTestId('check-or-call-action-button')).toBeEnabled();
});

test('hides waiting-to-start prompt once the local player is in the active hand', () => {
  const returnToTable = jest.fn();
  mockUseWorkerRoomState.mockReturnValue(workerRoomState({
    currentRound: 2,
    currentPlayers: ['p2'],
    players: [
      {peerId: 'p1', online: true, connected: true, seated: true, status: 'active'},
      {peerId: 'p2', online: true, connected: true, seated: true, status: 'active'},
    ],
    activePlayerCount: 2,
    playable: true,
    reason: 'ready',
  }));
  mockUseTexasHoldem.mockReturnValue(state({
    round: 2,
    players: ['p1', 'p2'],
    currentRoundFinished: false,
    whoseTurnAndCallAmount: {whoseTurn: 'p1', callAmount: 0},
    hole: [{suit: 'Diamond', rank: '4'}, {suit: 'Club', rank: 'Q'}],
    actions: {
      fireBet: jest.fn(),
      fireFold: jest.fn(),
      sitOut: jest.fn(),
      returnToTable,
      rejoinActiveHand: (round?: number | null) => returnToTable(round),
    },
  }) as unknown as ReturnType<typeof useTexasHoldem>);

  render(<TexasHoldemGameTable />);

  expect(screen.queryByTestId('seat-recovery-panel')).not.toBeInTheDocument();
});

test('keeps return-to-table retryable while waiting for worker confirmation', async () => {
  const returnToTable = jest.fn().mockResolvedValue(undefined);
  mockUseWorkerRoomState.mockReturnValue(workerRoomState({
    currentRound: 7,
    players: [
      {peerId: 'p1', online: true, connected: true, seated: false, status: 'timedOut', timedOut: true},
      {peerId: 'p2', online: true, connected: true, seated: true, status: 'active'},
    ],
    activePlayerCount: 1,
    playable: false,
    reason: 'waiting-for-seated-player',
  }));
  mockUseTexasHoldem.mockReturnValue(state({
    // A timed-out player is, by definition, not in a live local hand.
    round: undefined,
    currentRoundFinished: true,
    actions: {
      fireBet: jest.fn(),
      fireFold: jest.fn(),
      sitOut: jest.fn(),
      returnToTable,
      rejoinActiveHand: (round?: number | null) => returnToTable(round),
    },
  }) as unknown as ReturnType<typeof useTexasHoldem>);

  render(<TexasHoldemGameTable />);

  const button = screen.getByTestId('return-to-table-button');
  fireEvent.click(button);
  await waitFor(() => expect(returnToTable).toHaveBeenCalledTimes(1));
  expect(button).toBeEnabled();
  expect(button).toHaveTextContent('正在等待开局');

  fireEvent.click(button);
  await waitFor(() => expect(returnToTable).toHaveBeenCalledTimes(2));
});

test('does not show the next-hand staging panel behind timeout recovery', () => {
  mockUseWorkerRoomState.mockReturnValue(workerRoomState({
    currentRound: 1,
    players: [
      {peerId: 'p1', online: true, connected: true, seated: false, status: 'timedOut', timedOut: true},
      {peerId: 'p2', online: true, connected: true, seated: true, status: 'active'},
    ],
    activePlayerCount: 1,
    playable: false,
    reason: 'waiting-for-seated-player',
  }));
  mockUseTexasHoldem.mockReturnValue(state({
    round: 1,
    currentRoundFinished: true,
  }) as unknown as ReturnType<typeof useTexasHoldem>);

  render(<TexasHoldemGameTable />);

  expect(screen.getByTestId('seat-recovery-panel')).toBeInTheDocument();
  expect(screen.queryByTestId('staging')).toBeNull();
});

test('shows hand pause voting when a player leaves with missing keys', () => {
  const voteToVoidHand = jest.fn();
  mockUseTexasHoldem.mockReturnValue(state({
    handPause: {
      round: 1,
      missingPlayers: ['p2'],
      voters: ['p1'],
      approvals: [],
      rejections: [],
    },
    actions: {
      fireBet: jest.fn(),
      fireFold: jest.fn(),
      sitOut: jest.fn(),
      returnToTable: jest.fn(),
      rejoinActiveHand: jest.fn(),
      voteToVoidHand,
    },
  }) as unknown as ReturnType<typeof useTexasHoldem>);

  render(<TexasHoldemGameTable />);

  expect(screen.getByTestId('hand-pause-panel')).toHaveTextContent('本局暂停');
  expect(screen.getByTestId('hand-pause-panel')).toHaveTextContent('Bob');
  expect(screen.getByTestId('hand-pause-panel')).toHaveTextContent('同意立即作废：0/1');
  // The panel explains the actionable tip + why the table must wait.
  expect(screen.getByTestId('hand-pause-panel')).toHaveTextContent('原来那台浏览器');
  expect(screen.getByTestId('hand-pause-panel')).toHaveTextContent('轮流加密');

  // Only the "void & refund" action exists now (the table waits by default, so
  // there is no "keep waiting" button). With no unlock time set it is clickable.
  fireEvent.click(screen.getByTestId('void-hand-approve-button'));
  expect(voteToVoidHand).toHaveBeenCalledWith(true);
  expect(screen.queryByTestId('void-hand-reject-button')).toBeNull();
});

test('keeps original seats visible with flipped cards during showdown settlement', () => {
  mockUseTexasHoldem.mockReturnValue(state({
    currentRoundFinished: true,
    board: [
      {suit: 'Spade', rank: '8'},
      {suit: 'Heart', rank: 'K'},
      {suit: 'Club', rank: '5'},
      {suit: 'Diamond', rank: '9'},
      {suit: 'Heart', rank: 'Q'},
    ],
    hole: [
      {suit: 'Heart', rank: '3'},
      {suit: 'Club', rank: 'K'},
    ],
    holesPerPlayer: new Map([
      ['p1', [{suit: 'Heart', rank: '3'}, {suit: 'Club', rank: 'K'}]],
      ['p2', [{suit: 'Heart', rank: '6'}, {suit: 'Heart', rank: '8'}]],
    ]),
    lastWinningResult: {
      how: 'Showdown',
      round: 1,
      showdown: [
        {strength: 1, handValue: 1, players: ['p1']},
        {strength: 2, handValue: 2, players: ['p2']},
      ],
    },
    scoreBoard: new Map([['p1', 2], ['p2', -2]]),
    handScoreBoard: new Map([['p1', 2], ['p2', -2]]),
  }) as unknown as ReturnType<typeof useTexasHoldem>);

  render(<TexasHoldemGameTable />);

  expect(screen.getByTestId('opponents')).toBeInTheDocument();
  expect(screen.getByTestId('table')).not.toHaveClass('table-staging');
  expect(screen.getAllByTestId('hand-card-0').length).toBeGreaterThanOrEqual(2);
});

test('keeps original seats visible during fold-win settlement', () => {
  mockUseTexasHoldem.mockReturnValue(state({
    currentRoundFinished: true,
    board: [
      {suit: 'Spade', rank: '8'},
      {suit: 'Heart', rank: 'K'},
      {suit: 'Club', rank: '5'},
    ],
    lastWinningResult: {
      how: 'LastOneWins',
      round: 1,
      winner: 'p1',
    },
    handScoreBoard: new Map([['p1', 2], ['p2', -2]]),
  }) as unknown as ReturnType<typeof useTexasHoldem>);

  render(<TexasHoldemGameTable />);

  expect(screen.getByTestId('opponents')).toBeInTheDocument();
  expect(screen.getByTestId('table')).not.toHaveClass('table-staging');
  expect(screen.getByLabelText('chips awarded')).toBeInTheDocument();
});

test('restart match opens registration instead of dealing immediately', async () => {
  const startGame = jest.fn();
  const openRegistration = jest.fn().mockResolvedValue(undefined);
  mockUseTexasHoldem.mockReturnValue(state({
    round: 10,
    currentRoundFinished: true,
    startGame,
    lastWinningResult: {
      how: 'LastOneWins',
      round: 10,
      winner: 'p2',
    },
    seriesProgress: {current: 10, total: 10, complete: true},
    roundSettings: {initialFundAmount: 100, plannedRounds: 10, seriesStartRound: 1},
    actions: {
      fireBet: jest.fn(),
      fireFold: jest.fn(),
      sitOut: jest.fn(),
      returnToTable: jest.fn(),
      rejoinActiveHand: jest.fn(),
      openRegistration,
      voteToVoidHand: jest.fn(),
    },
  }) as unknown as ReturnType<typeof useTexasHoldem>);

  render(<TexasHoldemGameTable />);

  fireEvent.click(screen.getByTestId('score-board-new-table-button'));

  await waitFor(() => expect(openRegistration).toHaveBeenCalledTimes(1));
  expect(startGame).not.toHaveBeenCalled();
});

test('match registration reopens the lobby and asks players to join again', () => {
  const returnToTable = jest.fn();
  mockUseWorkerRoomState.mockReturnValue(workerRoomState({
    currentRound: null,
    currentPlayers: [],
    players: [
      {peerId: 'p1', online: true, connected: true, seated: false, status: 'watching', spectator: true},
      {peerId: 'p2', online: true, connected: true, seated: false, status: 'watching', spectator: true},
    ],
    activePlayerCount: 0,
    spectatorCount: 2,
    playable: false,
    reason: 'waiting-for-seated-player',
  }));
  mockUseTexasHoldem.mockReturnValue(state({
    round: 10,
    currentRoundFinished: true,
    lastWinningResult: {
      how: 'LastOneWins',
      round: 10,
      winner: 'p2',
    },
    seriesProgress: {current: 10, total: 10, complete: true},
    actions: {
      fireBet: jest.fn(),
      fireFold: jest.fn(),
      sitOut: jest.fn(),
      returnToTable,
      rejoinActiveHand: (round?: number | null) => returnToTable(round),
      openRegistration: jest.fn(),
      voteToVoidHand: jest.fn(),
    },
  }) as unknown as ReturnType<typeof useTexasHoldem>);

  render(<TexasHoldemGameTable />);

  expect(screen.getByTestId('staging')).toHaveTextContent('加入战局');
  expect(screen.getByTestId('staging-rail-list')).toHaveTextContent('观战区');
  fireEvent.click(screen.getByTestId('join-battle-button'));
  expect(returnToTable).toHaveBeenCalledWith(null);
});

test('cleans table visuals after match registration reopen so lobby is fresh', () => {
  const returnToTable = jest.fn();
  mockUseWorkerRoomState.mockReturnValue(workerRoomState({
    currentRound: null,
    currentPlayers: [],
    players: [
      {peerId: 'p1', online: true, connected: true, seated: false, status: 'watching', spectator: true},
      {peerId: 'p2', online: true, connected: true, seated: false, status: 'watching', spectator: true},
    ],
    activePlayerCount: 0,
    spectatorCount: 2,
    playable: false,
    reason: 'waiting-for-seated-player',
  }));
  mockUseTexasHoldem.mockReturnValue(state({
    round: 10,
    currentRoundFinished: true,
    board: [
      {suit: 'Club', rank: 'T'},
      {suit: 'Heart', rank: '9'},
      {suit: 'Heart', rank: 'Q'},
    ],
    potAmount: 320,
    players: ['p1', 'p2'],
    lastWinningResult: {
      how: 'Showdown',
      round: 10,
      showdown: [{strength: 1, handValue: 1, players: ['p1']}],
    },
    roundSettings: {initialFundAmount: 100, plannedRounds: 10, seriesStartRound: 1},
    seriesProgress: {current: 10, total: 10, complete: true},
    actions: {
      fireBet: jest.fn(),
      fireFold: jest.fn(),
      sitOut: jest.fn(),
      returnToTable,
      rejoinActiveHand: (round?: number | null) => returnToTable(round),
      openRegistration: jest.fn(),
      voteToVoidHand: jest.fn(),
    },
  }) as unknown as ReturnType<typeof useTexasHoldem>);

  render(<TexasHoldemGameTable />);

  expect(screen.getByTestId('staging')).toHaveTextContent('加入战局');
  expect(screen.queryByTestId('pot')).toBeNull();
  expect(screen.queryByTestId('board-card-0')).toBeNull();
  fireEvent.click(screen.getByTestId('join-battle-button'));
  expect(returnToTable).toHaveBeenCalledWith(null);
});

test('settlement chip delta uses only this hand, not the total score', () => {
  mockUseTexasHoldem.mockReturnValue(state({
    currentRoundFinished: true,
    board: [
      {suit: 'Club', rank: 'T'},
      {suit: 'Heart', rank: '9'},
      {suit: 'Heart', rank: 'Q'},
      {suit: 'Heart', rank: '7'},
      {suit: 'Heart', rank: '5'},
    ],
    hole: [
      {suit: 'Diamond', rank: 'K'},
      {suit: 'Club', rank: 'Q'},
    ],
    holesPerPlayer: new Map([
      ['p1', [{suit: 'Diamond', rank: 'K'}, {suit: 'Club', rank: 'Q'}]],
      ['p2', [{suit: 'Diamond', rank: '7'}, {suit: 'Heart', rank: '5'}]],
    ]),
    lastWinningResult: {
      how: 'Showdown',
      round: 1,
      showdown: [
        {strength: 1, handValue: 1, players: ['p1']},
        {strength: 2, handValue: 2, players: ['p2']},
      ],
    },
    scoreBoard: new Map([['p1', 300], ['p2', -300]]),
    handScoreBoard: new Map([['p1', 100], ['p2', -100]]),
  }) as unknown as ReturnType<typeof useTexasHoldem>);

  render(<TexasHoldemGameTable />);

  expect(screen.getByTestId('my-chip-delta')).toHaveTextContent('+$100');
});

test('keeps return-to-table prompt when the live hand excludes the local player', () => {
  mockUseWorkerRoomState.mockReturnValue(null);
  mockUseTexasHoldem.mockReturnValue(state({
    players: ['p2'],
  }) as unknown as ReturnType<typeof useTexasHoldem>);

  render(<TexasHoldemGameTable />);

  expect(screen.getByTestId('seat-recovery-panel')).toHaveTextContent('你已暂离牌桌');
});

test('keeps queued-next-hand return action available when worker hand excludes a seated local player before local sync', () => {
  const returnToTable = jest.fn();
  mockUseWorkerRoomState.mockReturnValue(workerRoomState({
    currentRound: 5,
    currentPlayers: ['p2', 'p3'],
    players: [
      {peerId: 'p1', online: true, connected: true, seated: true, status: 'active'},
      {peerId: 'p2', online: true, connected: true, seated: true, status: 'active'},
      {peerId: 'p3', online: true, connected: true, seated: true, status: 'active'},
    ],
    activePlayerCount: 3,
    onlineCount: 3,
    playable: true,
    reason: 'ready',
  }));
  mockUseTexasHoldem.mockReturnValue(state({
    round: undefined,
    currentRoundFinished: true,
    members: ['p1', 'p2', 'p3'],
    players: undefined,
    actions: {
      fireBet: jest.fn(),
      fireFold: jest.fn(),
      sitOut: jest.fn(),
      returnToTable,
      rejoinActiveHand: (round?: number | null) => returnToTable(round),
    },
  }) as unknown as ReturnType<typeof useTexasHoldem>);

  render(<TexasHoldemGameTable />);

  expect(screen.getByTestId('seat-recovery-panel')).toHaveTextContent('正在等待开局');
  expect(screen.getByTestId('seat-recovery-panel')).toHaveTextContent('请等待其他人入座');
  expect(screen.getByTestId('return-to-table-button')).toBeEnabled();
  fireEvent.click(screen.getByTestId('return-to-table-button'));
  expect(returnToTable).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('start-button')).toBeNull();
});

test('does not show return-to-table prompt after a normal fold', () => {
  const returnToTable = jest.fn();
  mockUseTexasHoldem.mockReturnValue(state({
    actionsDone: new Map([['p1', 'fold']]),
    actions: {
      fireBet: jest.fn(),
      fireFold: jest.fn(),
      sitOut: jest.fn(),
      returnToTable,
      rejoinActiveHand: (round?: number | null) => returnToTable(round),
    },
  }) as unknown as ReturnType<typeof useTexasHoldem>);

  render(<TexasHoldemGameTable />);

  expect(screen.queryByTestId('seat-recovery-panel')).toBeNull();
  expect(returnToTable).not.toHaveBeenCalled();
});

test('allows the player to leave during the next-hand countdown', async () => {
  const sitOut = jest.fn().mockResolvedValue(undefined);
  mockUseTexasHoldem.mockReturnValue(state({
    currentRoundFinished: true,
    actions: {
      fireBet: jest.fn(),
      fireFold: jest.fn(),
      sitOut,
      returnToTable: jest.fn(),
      rejoinActiveHand: jest.fn(),
    },
  }) as unknown as ReturnType<typeof useTexasHoldem>);

  render(<TexasHoldemGameTable />);

  const leaveButton = screen.getByTestId('leave-seat-button');
  expect(leaveButton).toBeEnabled();
  fireEvent.click(leaveButton);
  await waitFor(() => expect(sitOut).toHaveBeenCalledTimes(1));
});

test('starts the next hand from the countdown using the seated-player preflight', async () => {
  jest.useFakeTimers();
  const startGame = jest.fn().mockResolvedValue(undefined);
  try {
    mockUseTexasHoldem.mockReturnValue(state({
      round: 2,
      currentRoundFinished: true,
      startGame,
      canStartGame: jest.fn(() => true),
      roundSettings: {initialFundAmount: 100, plannedRounds: 10, seriesStartRound: 1},
    }) as unknown as ReturnType<typeof useTexasHoldem>);

    render(<TexasHoldemGameTable />);

    await act(async () => {
      jest.advanceTimersByTime(5250);
    });

    await waitFor(() => expect(startGame).toHaveBeenCalledWith(expect.objectContaining({
      initialFundAmount: 100,
      plannedRounds: 10,
      participants: ['p1', 'p2'],
    })));
    // The shuffle animation is now driven solely by the real shuffle transcript
    // (useEncryptedShuffleStatus), so it does not appear in this mocked next-hand
    // start test — the start call asserted above is the behavior under test.
  } finally {
    jest.useRealTimers();
  }
});

test('shows mid-hand joiners on the rail instead of table seats', () => {
  mockUseWorkerRoomState.mockReturnValue(workerRoomState({
    currentRound: 1,
    currentPlayers: ['p1', 'p2'],
    players: [
      {peerId: 'p1', online: true, connected: true, seated: true, status: 'active'},
      {peerId: 'p2', online: true, connected: true, seated: true, status: 'active'},
      {peerId: 'p3', online: true, connected: true, seated: false, status: 'watching', spectator: true},
    ],
    activePlayerCount: 2,
    spectatorCount: 1,
    onlineCount: 3,
    playable: true,
    reason: 'ready',
  }));
  mockUseTexasHoldem.mockReturnValue(state({
    members: ['p1', 'p2', 'p3'],
    players: ['p1', 'p2'],
  }) as unknown as ReturnType<typeof useTexasHoldem>);

  render(<TexasHoldemGameTable />);

  expect(screen.getByTestId('spectator-rail')).toHaveTextContent('观战区');
  expect(screen.getByTestId('spectator-rail')).toHaveTextContent('p3');
  expect(screen.getByTestId('spectator-rail')).toHaveTextContent('观战中');
  expect(screen.queryByTestId('opponent-1')).toBeNull();
});

test('next hand includes a rail player only after worker seats them for next hand', async () => {
  jest.useFakeTimers();
  const startGame = jest.fn().mockResolvedValue(undefined);
  mockUseWorkerRoomState.mockReturnValue(workerRoomState({
    currentRound: 3,
    currentPlayers: ['p1', 'p2'],
    players: [
      {peerId: 'p1', online: true, connected: true, seated: true, status: 'active'},
      {peerId: 'p2', online: true, connected: true, seated: true, status: 'active'},
      {peerId: 'p3', online: true, connected: true, seated: true, status: 'active'},
    ],
    activePlayerCount: 3,
    onlineCount: 3,
    playable: true,
    reason: 'ready',
  }));
  try {
    mockUseTexasHoldem.mockReturnValue(state({
      round: 3,
      currentRoundFinished: true,
      members: ['p1', 'p2', 'p3'],
      players: ['p1', 'p2'],
      startGame,
      canStartGame: jest.fn(() => true),
      roundSettings: {initialFundAmount: 100, plannedRounds: 10, seriesStartRound: 1},
    }) as unknown as ReturnType<typeof useTexasHoldem>);

    render(<TexasHoldemGameTable />);

    await act(async () => {
      jest.advanceTimersByTime(5250);
    });

    await waitFor(() => expect(startGame).toHaveBeenCalledWith(expect.objectContaining({
      participants: ['p1', 'p2', 'p3'],
    })));
    expect(screen.getByTestId('spectator-rail')).toHaveTextContent('等待开局');
  } finally {
    jest.useRealTimers();
  }
});

test('timed-out player cannot auto-start the next hand for seated players', async () => {
  jest.useFakeTimers();
  const startGame = jest.fn().mockResolvedValue(undefined);
  mockUseWorkerRoomState.mockReturnValue(workerRoomState({
    currentPlayers: ['p1', 'p2', 'p3'],
    players: [
      {peerId: 'p1', online: true, connected: true, seated: false, status: 'timedOut', timedOut: true},
      {peerId: 'p2', online: true, connected: true, seated: true, status: 'active'},
      {peerId: 'p3', online: true, connected: true, seated: true, status: 'active'},
    ],
    activePlayerCount: 2,
    onlineCount: 3,
    playable: true,
    reason: 'ready',
  }));
  try {
    mockUseTexasHoldem.mockReturnValue(state({
      round: 2,
      currentRoundFinished: true,
      members: ['p1', 'p2', 'p3'],
      players: ['p1', 'p2', 'p3'],
      startGame,
      canStartGame: jest.fn(() => true),
      roundSettings: {initialFundAmount: 100, plannedRounds: 10, seriesStartRound: 1},
    }) as unknown as ReturnType<typeof useTexasHoldem>);

    render(<TexasHoldemGameTable />);

    await act(async () => {
      jest.advanceTimersByTime(9000);
    });

    expect(startGame).not.toHaveBeenCalled();
    expect(screen.getByTestId('seat-recovery-panel')).toBeInTheDocument();
    expect(screen.getByTestId('spectator-rail')).toHaveTextContent('Alice');
    expect(screen.getByTestId('spectator-rail')).toHaveTextContent('超时离座');
  } finally {
    jest.useRealTimers();
  }
});

test('offline player is moved to watching and can sit back down', async () => {
  const returnToTable = jest.fn().mockResolvedValue(undefined);
  mockUseWorkerRoomState.mockReturnValue(workerRoomState({
    currentRound: 7,
    currentPlayers: ['p2'],
    players: [
      {peerId: 'p1', online: false, connected: false, seated: false, status: 'offline'},
      {peerId: 'p2', online: true, connected: true, seated: true, status: 'active'},
    ],
    activePlayerCount: 1,
    onlineCount: 1,
    playable: false,
    reason: 'waiting-for-online-player',
  }));
  mockUseTexasHoldem.mockReturnValue(state({
    round: undefined,
    currentRoundFinished: true,
    actions: {
      fireBet: jest.fn(),
      fireFold: jest.fn(),
      sitOut: jest.fn(),
      returnToTable,
      rejoinActiveHand: (round?: number | null) => returnToTable(round),
    },
  }) as unknown as ReturnType<typeof useTexasHoldem>);

  render(<TexasHoldemGameTable />);

  expect(screen.getByTestId('seat-recovery-panel')).toHaveTextContent('连接离线');
  expect(screen.getByTestId('seat-recovery-panel')).toHaveTextContent('本局已自动弃牌');
  expect(screen.getByTestId('return-to-table-button')).toHaveTextContent('重新坐下');
  fireEvent.click(screen.getByTestId('return-to-table-button'));
  await waitFor(() => expect(screen.getByTestId('seat-recovery-panel')).toHaveTextContent('正在等待开局'));
  await waitFor(() => expect(returnToTable).toHaveBeenCalledWith(7));
});

test('manual next-hand recovery is hidden for a non-designated starter', async () => {
  jest.useFakeTimers();
  const startGame = jest.fn().mockResolvedValue(undefined);
  try {
    mockUseTexasHoldem.mockReturnValue(state({
      round: 1,
      currentRoundFinished: true,
      startGame,
      canStartGame: jest.fn(() => true),
      roundSettings: {initialFundAmount: 100, plannedRounds: 10, seriesStartRound: 1},
    }) as unknown as ReturnType<typeof useTexasHoldem>);

    render(<TexasHoldemGameTable />);

    await act(async () => {
      jest.advanceTimersByTime(8500);
    });

    expect(startGame).not.toHaveBeenCalled();
    expect(screen.queryByTestId('continue-button')).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test('manual next-hand recovery returns the player to the table and waits for worker state', async () => {
  jest.useFakeTimers();
  const startGame = jest.fn().mockResolvedValue(undefined);
  const returnToTable = jest.fn().mockResolvedValue(undefined);
  mockUseWorkerRoomState.mockReturnValue(workerRoomState({
    players: [
      {peerId: 'p1', online: true, connected: true, seated: false, status: 'sittingOut', sittingOut: true},
      {peerId: 'p2', online: true, connected: true, seated: true, status: 'active'},
    ],
    activePlayerCount: 1,
    playable: false,
    reason: 'waiting-for-seated-player',
  }));
  try {
    mockUseTexasHoldem.mockReturnValue(state({
      round: 1,
      currentRoundFinished: true,
      startGame,
      roundSettings: {initialFundAmount: 100, plannedRounds: 10, seriesStartRound: 1},
      actions: {
        fireBet: jest.fn(),
        fireFold: jest.fn(),
        sitOut: jest.fn(),
        returnToTable,
        rejoinActiveHand: (round?: number | null) => returnToTable(round),
      },
    }) as unknown as ReturnType<typeof useTexasHoldem>);

    render(<TexasHoldemGameTable />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('return-to-table-button'));
    });

    await waitFor(() => expect(returnToTable).toHaveBeenCalledTimes(1));
    expect(startGame).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test('next-hand starter trusts the worker seated list instead of local preflight', async () => {
  jest.useFakeTimers();
  const startGame = jest.fn().mockResolvedValue(undefined);
  const returnToTable = jest.fn().mockResolvedValue(undefined);
  const canStartGame = jest.fn(() => false);
  mockUseWorkerRoomState.mockReturnValue(workerRoomState({
    currentRound: 2,
  }));
  try {
    mockUseTexasHoldem.mockReturnValue(state({
      round: 2,
      currentRoundFinished: true,
      startGame,
      canStartGame,
      roundSettings: {initialFundAmount: 100, plannedRounds: 10, seriesStartRound: 1},
      actions: {
        fireBet: jest.fn(),
        fireFold: jest.fn(),
        sitOut: jest.fn(),
        returnToTable,
        rejoinActiveHand: (round?: number | null) => returnToTable(round),
      },
    }) as unknown as ReturnType<typeof useTexasHoldem>);

    render(<TexasHoldemGameTable />);

    await act(async () => {
      jest.advanceTimersByTime(5250);
    });

    await waitFor(() => expect(startGame).toHaveBeenCalledWith(expect.objectContaining({
      initialFundAmount: 100,
      plannedRounds: 10,
      participants: ['p1', 'p2'],
    })));
    expect(returnToTable).not.toHaveBeenCalled();
    // When the worker IS playable, the worker seated list drives the start and the
    // host-only client fallback stays off (gated on !workerCanStartGame). The local
    // `canStartGame()` may be read as the fallback signal, but it must not start a
    // second hand: startGame is called exactly once.
    expect(startGame).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test('host starts the next hand from local state when the worker view is stale (unsticks 观战中)', async () => {
  jest.useFakeTimers();
  const startGame = jest.fn().mockResolvedValue(undefined);
  const canStartGame = jest.fn(() => true); // client itself can start (>=2 seated locally)
  // Worker view is stale/desynced: it thinks there aren't 2 active players (so it
  // is not "playable"), but the local client knows it has 2 seated. The host (p1)
  // itself still shows active, so this is the start path (not seat-recovery).
  mockUseWorkerRoomState.mockReturnValue(workerRoomState({
    currentRound: 2,
    currentPlayers: ['p1', 'p2'],
    players: [
      {peerId: 'p1', online: true, connected: true, seated: true, status: 'active'},
      {peerId: 'p2', online: false, connected: false, seated: false, status: 'offline'},
    ],
    activePlayerCount: 1,
    onlineCount: 1,
    playable: false,
    reason: 'waiting-for-seated-player',
  }));
  try {
    mockUseTexasHoldem.mockReturnValue(state({
      round: 2,
      currentRoundFinished: true,
      startGame,
      canStartGame,
      roundSettings: {initialFundAmount: 100, plannedRounds: 10, seriesStartRound: 1},
    }) as unknown as ReturnType<typeof useTexasHoldem>);

    render(<TexasHoldemGameTable />);
    await act(async () => {
      jest.advanceTimersByTime(5250);
    });

    // The host (p1, no HostId) is not blocked by the stale worker view: it starts
    // the next hand from local state, and exactly once (no double-deal).
    await waitFor(() => expect(startGame).toHaveBeenCalled());
    expect(startGame).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test('auto-starts next hand when the worker hand cannot continue but enough players are seated', async () => {
  jest.useFakeTimers();
  const startGame = jest.fn().mockResolvedValue(undefined);
  mockUseWorkerRoomState.mockReturnValue(workerRoomState({
    currentRound: 2,
    currentPlayers: ['p1'],
    players: [
      {peerId: 'p1', online: true, connected: true, seated: true, status: 'active'},
      {peerId: 'p2', online: true, connected: true, seated: true, status: 'active'},
    ],
    activePlayerCount: 2,
    onlineCount: 2,
    playable: true,
    reason: 'ready',
  }));
  try {
    mockUseTexasHoldem.mockReturnValue(state({
      round: 2,
      currentRoundFinished: false,
      players: ['p1'],
      startGame,
      canStartGame: jest.fn(() => false),
      roundSettings: {initialFundAmount: 100, plannedRounds: 10, seriesStartRound: 1},
    }) as unknown as ReturnType<typeof useTexasHoldem>);

    render(<TexasHoldemGameTable />);

    await act(async () => {
      jest.advanceTimersByTime(5250);
    });

    await waitFor(() => expect(startGame).toHaveBeenCalledWith(expect.objectContaining({
      initialFundAmount: 100,
      plannedRounds: 10,
      participants: ['p1', 'p2'],
    })));
    expect(screen.queryByTestId('seat-recovery-panel')).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test('does not throw a red error or leave the shuffle overlay stuck when only one player is seated', async () => {
  jest.useFakeTimers();
  const startGame = jest.fn().mockResolvedValue(undefined);
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  mockUseWorkerRoomState.mockReturnValue(workerRoomState({
    players: [
      {peerId: 'p1', online: true, connected: true, seated: true, status: 'active'},
      {peerId: 'p2', online: true, connected: true, seated: false, status: 'watching', spectator: true},
    ],
    currentPlayers: ['p1'],
    activePlayerCount: 1,
    spectatorCount: 1,
    onlineCount: 2,
    playable: false,
    reason: 'waiting-for-seated-player',
  }));
  try {
    mockUseTexasHoldem.mockReturnValue(state({
      round: 2,
      currentRoundFinished: true,
      startGame,
      canStartGame: jest.fn(() => false),
      roundSettings: {initialFundAmount: 100, plannedRounds: 10, seriesStartRound: 1},
    }) as unknown as ReturnType<typeof useTexasHoldem>);

    render(<TexasHoldemGameTable />);

    await act(async () => {
      jest.advanceTimersByTime(8500);
    });

    expect(startGame).not.toHaveBeenCalled();
    expect(screen.queryByTestId('shuffle-overlay')).toBeNull();
    expect(screen.queryByTestId('continue-button')).toBeNull();
    expect(screen.getByTestId('spectator-rail')).toHaveTextContent('观战区');
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  } finally {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    jest.useRealTimers();
  }
});

test('an established local player is never shown in the spectator rail even when the worker reports them watching (browser-authoritative seat)', () => {
  // The owner's symptom: after a Safari refresh the relay briefly reports the local
  // player as "watching", which used to drop them into the spectator rail (观战区).
  // Browser truth wins: the local engine has me in the live hand, so the relay's
  // opinion about my own seat is ignored and I am never rendered as a spectator.
  mockUseWorkerRoomState.mockReturnValue(workerRoomState({
    players: [
      {peerId: 'p1', online: true, connected: true, seated: false, status: 'watching', spectator: true},
      {peerId: 'p2', online: true, connected: true, seated: true, status: 'active'},
    ],
    spectators: [
      {peerId: 'p1', online: true, connected: true, seated: false, status: 'watching', spectator: true},
    ],
    spectatorCount: 1,
  }));
  // Local engine truth: p1 is a player in the live hand (round 1, not finished).
  mockUseTexasHoldem.mockReturnValue(state({
    round: 1,
    currentRoundFinished: false,
    players: ['p1', 'p2'],
  }) as unknown as ReturnType<typeof useTexasHoldem>);

  render(<TexasHoldemGameTable />);

  expect(screen.queryByTestId('spectator-rail')).toBeNull();
});

// S3: when the browser-authoritative reducer (`reduced`) is present, seat-recovery
// decisions come from the signed log, not the worker's (possibly stale) roomState.
const rsettings = {initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2};
const reducedFromLog = (log: ReducerEvent[], connected: string[]) =>
  reduceTexasHoldem(log, new Map(), connected);

test('reducer-authoritative: a re-seated player after a hand sees NO return-to-table panel even with a stale worker', () => {
  // The hand has ended in the signed log → both players are re-seated for the next hand.
  const reduced = reducedFromLog([
    {type: 'newRound', from: 'p1', round: 1, players: ['p1', 'p2'], settings: rsettings},
    {type: 'hand/result', from: 'p1', round: 1},
  ], ['p1', 'p2']);
  // The worker is STALE: still thinks the hand is live and reports p1 as merely watching
  // (this is exactly what stranded the refreshed player as "已离座").
  mockUseWorkerRoomState.mockReturnValue(workerRoomState({
    currentRound: 1,
    players: [
      {peerId: 'p1', online: true, connected: true, seated: false, status: 'watching'},
      {peerId: 'p2', online: true, connected: true, seated: true, status: 'active'},
    ],
    activePlayerCount: 1,
    playable: false,
  }));
  mockUseTexasHoldem.mockReturnValue(state({
    round: 1,
    currentRoundFinished: true,
    reduced,
  }) as unknown as ReturnType<typeof useTexasHoldem>);

  render(<TexasHoldemGameTable />);
  // The reducer says p1 is seated/active → no false "你已离座" panel (the livelock symptom).
  expect(screen.queryByTestId('seat-recovery-panel')).toBeNull();
});

test('reducer-authoritative: a player the LOG says is sitting out does see the return-to-table panel', () => {
  const reduced = reducedFromLog([
    {type: 'newRound', from: 'p1', round: 1, players: ['p1', 'p2'], settings: rsettings},
    {type: 'hand/result', from: 'p1', round: 1},
    {type: 'action/sitOut', from: 'p1'},
  ], ['p1', 'p2']);
  mockUseWorkerRoomState.mockReturnValue(workerRoomState());
  mockUseTexasHoldem.mockReturnValue(state({
    round: undefined,
    currentRoundFinished: true,
    reduced,
  }) as unknown as ReturnType<typeof useTexasHoldem>);

  render(<TexasHoldemGameTable />);
  expect(screen.getByTestId('seat-recovery-panel')).toBeInTheDocument();
});
