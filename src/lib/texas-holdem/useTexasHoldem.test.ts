import EventEmitter from "eventemitter3";
import {TexasHoldemGameRoomEvents, WinningResult} from "./TexasHoldemGameRoom";
import {StandardCard} from "../secureMentalPoker";
import {Hole} from "../rules";

import {renderHook, act} from "@testing-library/react";
import useTexasHoldem from "./useTexasHoldem";
import {TexasHoldem} from "../setup";

jest.mock('../setup');

// The mock at __mocks__/setup.ts provides an EventEmitter-based stub.
// We need emit(), so cast the listener and add the missing methods.
const emitter = new EventEmitter<TexasHoldemGameRoomEvents>();
(TexasHoldem as any).listener = {
  on: emitter.on.bind(emitter),
  off: emitter.off.bind(emitter),
  once: emitter.once.bind(emitter),
};
(TexasHoldem as any).bet = jest.fn().mockResolvedValue(undefined);
(TexasHoldem as any).fold = jest.fn().mockResolvedValue(undefined);
(TexasHoldem as any).sitOut = jest.fn().mockResolvedValue(undefined);
(TexasHoldem as any).returnToTable = jest.fn().mockResolvedValue(undefined);
(TexasHoldem as any).openRegistration = jest.fn().mockResolvedValue(undefined);
(TexasHoldem as any).voteToVoidHand = jest.fn().mockResolvedValue(undefined);
(TexasHoldem as any).startNewRound = jest.fn().mockResolvedValue(undefined);

const mockBet = (TexasHoldem as any).bet as jest.Mock;
const mockFold = (TexasHoldem as any).fold as jest.Mock;
const mockSitOut = (TexasHoldem as any).sitOut as jest.Mock;
const mockReturnToTable = (TexasHoldem as any).returnToTable as jest.Mock;
const mockOpenRegistration = (TexasHoldem as any).openRegistration as jest.Mock;
const mockVoteToVoidHand = (TexasHoldem as any).voteToVoidHand as jest.Mock;
const mockStartNewRound = (TexasHoldem as any).startNewRound as jest.Mock;

const defaultSnapshot = () => ({
  currentRound: undefined,
  playersByRound: new Map(),
  boardByRound: new Map(),
  holesByRound: new Map(),
  whoseTurnByRound: new Map(),
  potAmount: 0,
  winnersByRound: new Map(),
  handPauseByRound: new Map(),
  settingsByRound: new Map(),
  bankrolls: new Map(),
});

beforeEach(() => {
  emitter.removeAllListeners();
  delete (TexasHoldem as any).peerId;
  delete (TexasHoldem as any).status;
  delete (TexasHoldem as any).members;
  (TexasHoldem as any).getStateSnapshot = jest.fn(defaultSnapshot);
  delete (TexasHoldem as any).getTranscript;
  try { localStorage.clear(); } catch { /* jsdom */ }
  mockBet.mockClear();
  mockFold.mockClear();
  mockSitOut.mockClear();
  mockReturnToTable.mockClear();
  mockOpenRegistration.mockClear();
  mockVoteToVoidHand.mockClear();
  mockStartNewRound.mockClear();
});

describe('useTexasHoldem', () => {
  test('initial state', () => {
    const {result} = renderHook(() => useTexasHoldem());

    expect(result.current.peerState).toBe('NotReady');
    expect(result.current.playerId).toBeUndefined();
    expect(result.current.members).toEqual([]);
    expect(result.current.round).toBeUndefined();
    expect(result.current.players).toBeUndefined();
    expect(result.current.smallBlind).toBeUndefined();
    expect(result.current.bigBlind).toBeUndefined();
    expect(result.current.button).toBeUndefined();
    expect(result.current.board).toEqual([]);
    expect(result.current.hole).toBeUndefined();
    expect(result.current.holesPerPlayer).toBeUndefined();
    expect(result.current.whoseTurnAndCallAmount).toBeNull();
    expect(result.current.potAmount).toBe(0);
    expect(result.current.bankrolls.size).toBe(0);
    expect(result.current.scoreBoard.size).toBe(0);
    expect(result.current.handScoreBoard.size).toBe(0);
    expect(result.current.totalDebt.size).toBe(0);
    expect(result.current.myBetAmount).toBeUndefined();
    expect(result.current.lastWinningResult).toBeUndefined();
    expect(result.current.currentRoundFinished).toBe(true); // no round = finished
    expect(result.current.actionsDone).toBeNull();
  });

  test('connected event sets playerId', () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('connected', 'player-A');
    });

    expect(result.current.playerId).toBe('player-A');
  });

  test('uses already-connected state when the event fired before mounting', () => {
    (TexasHoldem as any).peerId = 'player-before-mount';
    (TexasHoldem as any).status = 'PeerServerConnected';
    (TexasHoldem as any).members = ['player-before-mount'];

    const {result} = renderHook(() => useTexasHoldem());

    expect(result.current.playerId).toBe('player-before-mount');
    expect(result.current.peerState).toBe('PeerServerConnected');
    expect(result.current.members).toEqual(['player-before-mount']);
  });

  test('status event updates peerState', () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('status', 'HostConnected');
    });

    expect(result.current.peerState).toBe('HostConnected');
  });

  test('members event updates members', () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('members', ['A', 'B', 'C']);
    });

    expect(result.current.members).toEqual(['A', 'B', 'C']);
  });

  test('players event sets round, players, smallBlind, bigBlind, button', () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('players', 1, ['Alice', 'Bob', 'Charlie']);
    });

    expect(result.current.round).toBe(1);
    expect(result.current.players).toEqual(['Alice', 'Bob', 'Charlie']);
    expect(result.current.smallBlind).toBe('Alice');
    expect(result.current.bigBlind).toBe('Bob');
    expect(result.current.button).toBe('Charlie');
  });

  test('players event with 2 players: button is last player', () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('players', 1, ['Alice', 'Bob']);
    });

    expect(result.current.smallBlind).toBe('Alice');
    expect(result.current.bigBlind).toBe('Bob');
    expect(result.current.button).toBe('Bob');
  });

  test('winner event restores round and players from snapshot when the client missed setup', () => {
    (TexasHoldem as any).getStateSnapshot = jest.fn(() => ({
      ...defaultSnapshot(),
      playersByRound: new Map([[1, ['A', 'B']]]),
    }));
    const {result} = renderHook(() => useTexasHoldem());

    const winResult: WinningResult = {
      how: 'LastOneWins',
      round: 1,
      winner: 'B',
    };

    act(() => {
      emitter.emit('winner', winResult);
    });

    expect(result.current.round).toBe(1);
    expect(result.current.players).toEqual(['A', 'B']);
    expect(result.current.currentRoundFinished).toBe(true);
    expect(result.current.lastWinningResult).toEqual(winResult);
  });

  test('fund events update bankrolls', () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('fund', 100, undefined, 'Alice');
      emitter.emit('fund', 200, undefined, 'Bob');
    });

    expect(result.current.bankrolls.get('Alice')).toBe(100);
    expect(result.current.bankrolls.get('Bob')).toBe(200);

    act(() => {
      emitter.emit('fund', 95, 100, 'Alice');
    });

    expect(result.current.bankrolls.get('Alice')).toBe(95);
  });

  test('fund events update scoreBoard (non-borrowed)', () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('fund', 100, 0, 'Alice');
    });

    expect(result.current.scoreBoard.get('Alice')).toBe(100);
    expect(result.current.handScoreBoard.get('Alice')).toBe(100);
    expect(result.current.totalDebt.size).toBe(0);

    act(() => {
      emitter.emit('fund', 95, 100, 'Alice');
    });

    expect(result.current.scoreBoard.get('Alice')).toBe(95);
    expect(result.current.handScoreBoard.get('Alice')).toBe(95);
  });

  test('handScoreBoard resets when a new hand starts', () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('players', 1, ['Alice', 'Bob']);
      emitter.emit('fund', 90, 100, 'Alice');
      emitter.emit('fund', 110, 100, 'Bob');
    });

    expect(result.current.scoreBoard.get('Alice')).toBe(-10);
    expect(result.current.scoreBoard.get('Bob')).toBe(10);
    expect(result.current.handScoreBoard.get('Alice')).toBe(-10);
    expect(result.current.handScoreBoard.get('Bob')).toBe(10);

    act(() => {
      emitter.emit('players', 2, ['Bob', 'Alice']);
    });

    expect(result.current.scoreBoard.get('Alice')).toBe(-10);
    expect(result.current.scoreBoard.get('Bob')).toBe(10);
    expect(result.current.handScoreBoard.size).toBe(0);

    act(() => {
      emitter.emit('fund', 85, 90, 'Alice');
    });

    expect(result.current.scoreBoard.get('Alice')).toBe(-15);
    expect(result.current.handScoreBoard.get('Alice')).toBe(-5);
  });

  test('borrowed fund events update totalDebt, not scoreBoard', () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('fund', 100, 0, 'Alice', true);
    });

    expect(result.current.totalDebt.get('Alice')).toBe(100);
    expect(result.current.scoreBoard.has('Alice')).toBe(false);
    expect(result.current.handScoreBoard.has('Alice')).toBe(false);
  });

  test('board events update board', () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('players', 1, ['A', 'B']);
    });

    expect(result.current.board).toEqual([]);

    const flop: [StandardCard, StandardCard, StandardCard] = [
      {suit: 'Club', rank: 'A'},
      {suit: 'Heart', rank: 'K'},
      {suit: 'Diamond', rank: 'Q'},
    ];
    act(() => {
      emitter.emit('board', 1, flop);
    });

    expect(result.current.board).toEqual(flop);

    const turn = [...flop, {suit: 'Spade', rank: 'J'}] as [StandardCard, StandardCard, StandardCard, StandardCard];
    act(() => {
      emitter.emit('board', 1, turn);
    });

    expect(result.current.board).toEqual(turn);

    const river = [...turn, {suit: 'Club', rank: 'T'}] as [StandardCard, StandardCard, StandardCard, StandardCard, StandardCard];
    act(() => {
      emitter.emit('board', 1, river);
    });

    expect(result.current.board).toEqual(river);
  });

  test('hole events set myHole and holesPerPlayer', () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('connected', 'Alice');
      emitter.emit('players', 1, ['Alice', 'Bob']);
    });

    const aliceHole: Hole = [
      {suit: 'Club', rank: 'A'},
      {suit: 'Heart', rank: 'K'},
    ];
    const bobHole: Hole = [
      {suit: 'Diamond', rank: '2'},
      {suit: 'Spade', rank: '3'},
    ];

    act(() => {
      emitter.emit('hole', 1, 'Alice', aliceHole);
      emitter.emit('hole', 1, 'Bob', bobHole);
    });

    expect(result.current.hole).toEqual(aliceHole);
    expect(result.current.holesPerPlayer?.get('Alice')).toEqual(aliceHole);
    expect(result.current.holesPerPlayer?.get('Bob')).toEqual(bobHole);
  });

  test('hole is undefined when playerId not set', () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('players', 1, ['Alice', 'Bob']);
      emitter.emit('hole', 1, 'Alice', [
        {suit: 'Club', rank: 'A'},
        {suit: 'Heart', rank: 'K'},
      ]);
    });

    expect(result.current.hole).toBeUndefined();
    expect(result.current.holesPerPlayer?.get('Alice')).toBeDefined();
  });

  test('whoseTurn events update whoseTurnAndCallAmount', () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('players', 1, ['A', 'B']);
    });

    act(() => {
      emitter.emit('whoseTurn', 1, 'A', {callAmount: 2});
    });

    expect(result.current.whoseTurnAndCallAmount).toEqual({whoseTurn: 'A', callAmount: 2});

    act(() => {
      emitter.emit('whoseTurn', 1, null);
    });

    expect(result.current.whoseTurnAndCallAmount).toBeNull();
  });

  test('whoseTurn without actionMeta defaults callAmount to 0', () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('players', 1, ['A', 'B']);
    });

    act(() => {
      emitter.emit('whoseTurn', 1, 'A');
    });

    expect(result.current.whoseTurnAndCallAmount).toEqual({whoseTurn: 'A', callAmount: 0});
  });

  test('pot event updates potAmount', () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('pot', 1, 15);
    });

    expect(result.current.potAmount).toBe(15);
  });

  test('bet events track actionsDone', () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('players', 1, ['A', 'B']);
    });

    act(() => {
      emitter.emit('bet', 1, 5, 'A', false);
    });

    expect(result.current.actionsDone?.get('A')).toBe(5);

    act(() => {
      emitter.emit('bet', 1, 10, 'A', false);
    });

    expect(result.current.actionsDone?.get('A')).toBe(15);
  });

  test('all-in bet sets action to "all-in"', () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('players', 1, ['A', 'B']);
    });

    act(() => {
      emitter.emit('bet', 1, 100, 'A', true);
    });

    expect(result.current.actionsDone?.get('A')).toBe('all-in');
  });

  test('fold event sets action to "fold"', () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('players', 1, ['A', 'B']);
    });

    act(() => {
      emitter.emit('fold', 1, 'A');
    });

    expect(result.current.actionsDone?.get('A')).toBe('fold');
  });

  test('check (bet 0) shows as "check"', () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('players', 1, ['A', 'B']);
    });

    act(() => {
      emitter.emit('bet', 1, 0, 'A', false);
    });

    expect(result.current.actionsDone?.get('A')).toBe('check');
  });

  test('allSet clears bet actions but keeps fold/all-in', () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('players', 1, ['A', 'B', 'C']);
    });

    act(() => {
      emitter.emit('bet', 1, 5, 'A', false);
      emitter.emit('fold', 1, 'B');
      emitter.emit('bet', 1, 100, 'C', true);
    });

    expect(result.current.actionsDone?.get('A')).toBe(5);
    expect(result.current.actionsDone?.get('B')).toBe('fold');
    expect(result.current.actionsDone?.get('C')).toBe('all-in');

    act(() => {
      emitter.emit('allSet', 1);
    });

    expect(result.current.actionsDone?.has('A')).toBe(false);
    expect(result.current.actionsDone?.get('B')).toBe('fold');
    expect(result.current.actionsDone?.get('C')).toBe('all-in');
  });

  test('winner event clears actionsDone', () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('players', 1, ['A', 'B']);
      emitter.emit('bet', 1, 5, 'A', false);
    });

    expect(result.current.actionsDone?.get('A')).toBe(5);

    act(() => {
      emitter.emit('winner', {how: 'LastOneWins', round: 1, winner: 'B'} as WinningResult);
    });

    expect(result.current.actionsDone).toBeNull();
  });

  test('bet events track myBetAmount for current player', () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('connected', 'Alice');
      emitter.emit('players', 1, ['Alice', 'Bob']);
    });

    act(() => {
      emitter.emit('bet', 1, 1, 'Alice', false);
    });

    expect(result.current.myBetAmount).toBe(1);

    act(() => {
      emitter.emit('bet', 1, 3, 'Alice', false);
    });

    expect(result.current.myBetAmount).toBe(4);

    act(() => {
      emitter.emit('bet', 1, 10, 'Bob', false);
    });

    expect(result.current.myBetAmount).toBe(4);
  });

  test('winner event sets lastWinningResult and currentRoundFinished', () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('players', 1, ['A', 'B']);
    });

    expect(result.current.currentRoundFinished).toBe(false);
    expect(result.current.lastWinningResult).toBeUndefined();

    const winResult: WinningResult = {
      how: 'LastOneWins',
      round: 1,
      winner: 'B',
    };

    act(() => {
      emitter.emit('winner', winResult);
    });

    expect(result.current.lastWinningResult).toEqual(winResult);
    expect(result.current.currentRoundFinished).toBe(true);
  });

  test('showdown winner result', () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('players', 1, ['A', 'B']);
    });

    const showdownResult: WinningResult = {
      how: 'Showdown',
      round: 1,
      showdown: [
        {strength: 100, handValue: 1, players: ['A']},
        {strength: 200, handValue: 2, players: ['B']},
      ],
    };

    act(() => {
      emitter.emit('winner', showdownResult);
    });

    expect(result.current.lastWinningResult).toEqual(showdownResult);
    expect(result.current.currentRoundFinished).toBe(true);
  });

  test('fireBet calls TexasHoldem.bet with current round', async () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('players', 1, ['A', 'B']);
    });

    await act(async () => {
      await result.current.actions.fireBet(10);
    });

    expect(mockBet).toHaveBeenCalledWith(1, 10);
  });

  test('fireBet does nothing when no round', async () => {
    const {result} = renderHook(() => useTexasHoldem());

    await act(async () => {
      await result.current.actions.fireBet(10);
    });

    expect(mockBet).not.toHaveBeenCalled();
  });

  test('fireFold calls TexasHoldem.fold with current round', async () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('players', 1, ['A', 'B']);
    });

    await act(async () => {
      await result.current.actions.fireFold();
    });

    expect(mockFold).toHaveBeenCalledWith(1);
  });

  test('fireFold does nothing when no round', async () => {
    const {result} = renderHook(() => useTexasHoldem());

    await act(async () => {
      await result.current.actions.fireFold();
    });

    expect(mockFold).not.toHaveBeenCalled();
  });

  test('sitOut calls TexasHoldem.sitOut with current round', async () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('players', 1, ['A', 'B']);
    });

    await act(async () => {
      await result.current.actions.sitOut();
    });

    expect(mockSitOut).toHaveBeenCalledWith(1);
  });

  test('sitOut can mark the player as watching before a round exists', async () => {
    const {result} = renderHook(() => useTexasHoldem());

    await act(async () => {
      await result.current.actions.sitOut();
    });

    expect(mockSitOut).toHaveBeenCalledWith(null);
  });

  test('returnToTable calls TexasHoldem.returnToTable with current round', async () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('players', 1, ['A', 'B']);
    });

    await act(async () => {
      await result.current.actions.returnToTable();
    });

    expect(mockReturnToTable).toHaveBeenCalledWith(1);
  });

  test('returnToTable can use a worker-provided round when local round is missing', async () => {
    const {result} = renderHook(() => useTexasHoldem());

    await act(async () => {
      await result.current.actions.returnToTable(7);
    });

    expect(mockReturnToTable).toHaveBeenCalledWith(7);
  });

  test('returnToTable can join registration without a local round', async () => {
    const {result} = renderHook(() => useTexasHoldem());

    await act(async () => {
      await result.current.actions.returnToTable(null);
    });

    expect(mockReturnToTable).toHaveBeenCalledWith(null);
  });

  test('openRegistration asks the worker to clear the next match roster', async () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('players', 10, ['A', 'B']);
    });

    await act(async () => {
      await result.current.actions.openRegistration();
    });

    expect(mockOpenRegistration).toHaveBeenCalledWith(10);
  });

  test('startGame calls TexasHoldem.startNewRound with defaults', async () => {
    const {result} = renderHook(() => useTexasHoldem());

    await act(async () => {
      await result.current.startGame();
    });

  expect(mockStartNewRound).toHaveBeenCalledWith({
      bits: 1024,
      initialFundAmount: 100,
      smallBlindAmount: 1,
      bigBlindAmount: 2,
      autoFoldTimeoutSeconds: 60,
      plannedRounds: 10,
      seriesStartRound: undefined,
      participants: undefined,
    });
  });

  test('startGame passes custom settings', async () => {
    const {result} = renderHook(() => useTexasHoldem());

    await act(async () => {
      await result.current.startGame({initialFundAmount: 500, bits: 128});
    });

    expect(mockStartNewRound).toHaveBeenCalledWith({
      bits: 128,
      initialFundAmount: 500,
      smallBlindAmount: 1,
      bigBlindAmount: 2,
      autoFoldTimeoutSeconds: 60,
      plannedRounds: 10,
      seriesStartRound: undefined,
      participants: undefined,
    });
  });

  test('startGame passes planned round settings', async () => {
    const {result} = renderHook(() => useTexasHoldem());

    await act(async () => {
      await result.current.startGame({initialFundAmount: 500, plannedRounds: 3, seriesStartRound: 4});
    });

    expect(mockStartNewRound).toHaveBeenCalledWith({
      bits: 1024,
      initialFundAmount: 500,
      smallBlindAmount: 1,
      bigBlindAmount: 2,
      autoFoldTimeoutSeconds: 60,
      plannedRounds: 3,
      seriesStartRound: 4,
      participants: undefined,
    });
  });

  test('startGame passes custom blind settings', async () => {
    const {result} = renderHook(() => useTexasHoldem());

    await act(async () => {
      await result.current.startGame({initialFundAmount: 500, smallBlindAmount: 5, bigBlindAmount: 10});
    });

  expect(mockStartNewRound).toHaveBeenCalledWith({
      bits: 1024,
      initialFundAmount: 500,
      smallBlindAmount: 5,
      bigBlindAmount: 10,
      autoFoldTimeoutSeconds: 60,
      plannedRounds: 10,
      seriesStartRound: undefined,
      participants: undefined,
    });
  });

  test('round change resets board for new round', () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('players', 1, ['A', 'B']);
      emitter.emit('board', 1, [
        {suit: 'Club', rank: 'A'},
        {suit: 'Heart', rank: 'K'},
        {suit: 'Diamond', rank: 'Q'},
      ]);
    });

    expect(result.current.board).toHaveLength(3);

    act(() => {
      emitter.emit('players', 2, ['B', 'A']);
    });

    expect(result.current.round).toBe(2);
    expect(result.current.board).toEqual([]);
  });

  test('fold after bet still shows fold', () => {
    const {result} = renderHook(() => useTexasHoldem());

    act(() => {
      emitter.emit('players', 1, ['A', 'B']);
    });

    act(() => {
      emitter.emit('bet', 1, 5, 'A', false);
    });

    expect(result.current.actionsDone?.get('A')).toBe(5);

    act(() => {
      emitter.emit('fold', 1, 'A');
    });

    expect(result.current.actionsDone?.get('A')).toBe('fold');
  });

  test('cleanup removes listeners on unmount', () => {
    const {unmount} = renderHook(() => useTexasHoldem());

    unmount();

    const eventNames: Array<keyof TexasHoldemGameRoomEvents> = [
      'connected', 'status', 'members', 'players', 'fund',
      'board', 'hole', 'whoseTurn', 'pot', 'bet', 'fold', 'allSet', 'winner',
    ];

    for (const eventName of eventNames) {
      expect(emitter.listenerCount(eventName)).toBe(0);
    }
  });

  // S2: when a transcript IS present, pot and whose-turn come from the pure reducer
  // (folding the ordered signed log) rather than the raw last-event — the browser-
  // authoritative path that converges across clients. (BROWSER_AUTHORITATIVE_REWORK_PLAN.)
  describe('reducer-driven pot/turn when a transcript is present', () => {
    const entry = (index: number, transportSender: string, wireEvent: any) => ({
      index, previousHash: '', eventHash: '', recordedAt: '', transportSender,
      scope: 'public' as const, signed: false, payloadHash: '', wireEvent,
    });
    const settings = { initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2 };
    const setTranscript = (entries: any[]) => {
      (TexasHoldem as any).getTranscript = jest.fn(() => ({
        version: 'fairpoker.transcript.v1', finalHash: 'sha256:x', entries,
      }));
    };

    test('pot and whose-turn are derived from the reducer, overriding the event path', () => {
      // A stale/wrong event-path pot+turn (what a desynced client might have).
      setTranscript([
        entry(0, 'A', { type: 'newRound', round: 1, players: ['A', 'B'], settings }),
      ]);
      const {result} = renderHook(() => useTexasHoldem());
      act(() => {
        emitter.emit('transcript', {} as any);
        emitter.emit('players', 1, ['A', 'B']);
        // Conflicting event-path values that must be IGNORED in favour of the reducer.
        emitter.emit('pot', 1, 999);
        emitter.emit('whoseTurn', 1, 'B', { callAmount: 777 });
      });
      // Heads-up: SB=A(1), BB=B(2) → pot 3, first to act = A (SB), call = BB-SB = 1.
      expect(result.current.potAmount).toBe(3);
      expect(result.current.whoseTurnAndCallAmount).toEqual({ whoseTurn: 'A', callAmount: 1 });
    });

    test('reducer reflects a called bet: pot grows and the turn passes to the BB option', () => {
      setTranscript([
        entry(0, 'A', { type: 'newRound', round: 1, players: ['A', 'B'], settings }),
        entry(1, 'A', { type: 'action/bet', round: 1, amount: 1 }), // SB completes to 2
      ]);
      const {result} = renderHook(() => useTexasHoldem());
      act(() => {
        emitter.emit('transcript', {} as any);
        emitter.emit('players', 1, ['A', 'B']);
      });
      expect(result.current.potAmount).toBe(4); // A:2 + B:2
      expect(result.current.whoseTurnAndCallAmount).toEqual({ whoseTurn: 'B', callAmount: 0 });
    });

    test('falls back to the event path when there is no transcript', () => {
      const {result} = renderHook(() => useTexasHoldem());
      act(() => {
        emitter.emit('players', 1, ['A', 'B']);
        emitter.emit('pot', 1, 42);
        emitter.emit('whoseTurn', 1, 'B', { callAmount: 5 });
      });
      expect(result.current.potAmount).toBe(42);
      expect(result.current.whoseTurnAndCallAmount).toEqual({ whoseTurn: 'B', callAmount: 5 });
    });
  });
});

describe('S4 history persistence', () => {
  test('a resolved hand survives a remount (refresh) via localStorage', () => {
    const {result, unmount} = renderHook(() => useTexasHoldem());
    act(() => {
      emitter.emit('players', 1, ['A', 'B']);
      emitter.emit('winner', {how: 'LastOneWins', round: 1, winner: 'A'} as WinningResult);
    });
    expect(result.current.roundHistory.find(h => h.round === 1)?.winningResult).toBeTruthy();
    unmount();

    // Simulate a page refresh: a brand-new hook with NO live events still shows the
    // past hand, rebuilt from localStorage.
    const {result: result2} = renderHook(() => useTexasHoldem());
    const persisted = result2.current.roundHistory.find(h => h.round === 1);
    expect(persisted?.winningResult).toMatchObject({how: 'LastOneWins', winner: 'A'});
    expect(persisted?.players).toEqual(['A', 'B']);
  });
});
