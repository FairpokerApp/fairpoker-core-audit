import {act, fireEvent, render, screen, waitFor} from "@testing-library/react";
import Staging, {buildNewTableUrl} from "./Staging";
import {WorkerRoomState} from "../lib/CloudflareRelayTransport";

function workerRoomState(overrides: Partial<WorkerRoomState> = {}): WorkerRoomState {
  return {
    version: 1,
    source: 'cloudflare-worker',
    roomId: 'table-test',
    generatedAt: Date.now(),
    viewerPeerId: 'player1',
    latestEventSeq: 1,
    currentRound: null,
    currentPlayers: [],
    currentTurn: null,
    players: [
      {peerId: 'player1', online: true, connected: true, seated: true, status: 'active'},
      {peerId: 'player2', online: true, connected: true, seated: true, status: 'active'},
    ],
    activePlayerCount: 2,
    onlineCount: 2,
    roomValid: true,
    playable: true,
    reason: 'ready',
    ...overrides,
  };
}

test('rendering does not crash', () => {
  render(<Staging
    round={1}
    playerId={'player1'}
    members={[]}
    startGame={() => {}}
  />);
});

test('new table link clears stale room parameters but keeps local game entry', () => {
  const url = new URL(buildNewTableUrl(
    'http://127.0.0.1:3101/?entry=game&gameRoomId=old-host&tableId=old-table',
  ));
  expect(url.searchParams.get('entry')).toBe('game');
  expect(url.searchParams.get('gameRoomId')).toBeNull();
  expect(url.searchParams.get('tableId')).toMatch(/^table-/);
  expect(url.searchParams.get('tableId')).not.toBe('old-table');
});

test('shows planned rounds input before the first hand', () => {
  const startGame = jest.fn();
  render(<Staging
    round={undefined}
    playerId={'player1'}
    members={['player1', 'player2']}
    startGame={startGame}
    roomState={workerRoomState()}
  />);

  expect(screen.getByTestId('planned-rounds-input')).toHaveValue(10);
  expect(screen.getByTestId('sb-input')).toHaveValue(1);
  expect(screen.getByTestId('bb-input')).toHaveValue(2);
  expect(screen.getByTestId('auto-fold-timeout-input')).toHaveValue(60);
  expect(screen.queryByTestId('encryption-256-option')).toBeNull();
  expect(screen.queryByTestId('series-progress-card')).toBeNull();
  expect(screen.queryByTestId('legal-risk-card')).toBeNull();
  expect(screen.getByTestId('start-button')).toBeEnabled();
});

test('new arrivals stay on the rail until they join the match', () => {
  const onReturnToTable = jest.fn();
  render(<Staging
    round={undefined}
    playerId={'player1'}
    members={['player1', 'player2']}
    startGame={jest.fn()}
    onReturnToTable={onReturnToTable}
    roomState={workerRoomState({
      players: [
        {peerId: 'player1', online: true, connected: true, seated: false, status: 'watching', spectator: true},
        {peerId: 'player2', online: true, connected: true, seated: true, status: 'active'},
      ],
      activePlayerCount: 1,
      spectatorCount: 1,
      playable: false,
      reason: 'waiting-for-seated-player',
    })}
  />);

  expect(screen.getByTestId('staging-join-panel')).toHaveTextContent('加入战局');
  expect(screen.getByTestId('staging-rail-list')).toHaveTextContent('我');
  expect(screen.getByTestId('staging-rail-list')).toHaveTextContent('观战中');
  expect(screen.queryByTestId('start-button')).toBeNull();
  fireEvent.click(screen.getByTestId('join-battle-button'));
  expect(onReturnToTable).toHaveBeenCalledTimes(1);
});

test('host can start with seated players while staying on the rail', () => {
  const startGame = jest.fn();
  render(<Staging
    round={undefined}
    playerId={'player1'}
    members={['player1', 'player2', 'player3']}
    startGame={startGame}
    onReturnToTable={jest.fn()}
    roomState={workerRoomState({
      players: [
        {peerId: 'player1', online: true, connected: true, seated: false, status: 'watching', spectator: true},
        {peerId: 'player2', online: true, connected: true, seated: true, status: 'active'},
        {peerId: 'player3', online: true, connected: true, seated: true, status: 'active'},
      ],
      activePlayerCount: 2,
      spectatorCount: 1,
      playable: true,
      reason: 'ready',
    })}
  />);

  expect(screen.getByTestId('staging-join-panel')).toHaveTextContent('加入战局');
  expect(screen.getByTestId('staging-participants')).toHaveTextContent('player');
  expect(screen.getByTestId('start-button')).toBeEnabled();
});

test('passes editable blind amounts when starting', () => {
  const startGame = jest.fn();
  render(<Staging
    round={undefined}
    playerId={'player1'}
    members={['player1', 'player2']}
    startGame={startGame}
    roomState={workerRoomState()}
  />);

  fireEvent.change(screen.getByTestId('sb-input'), {target: {value: '5'}});
  fireEvent.change(screen.getByTestId('bb-input'), {target: {value: '10'}});
  fireEvent.click(screen.getByTestId('start-button'));

  expect(startGame).toHaveBeenCalledWith(expect.objectContaining({
    smallBlindAmount: 5,
    bigBlindAmount: 10,
  }));
});

test('broadcasts pending setup changes before the first hand', async () => {
  const onRoundSettingsChange = jest.fn();
  render(<Staging
    round={undefined}
    playerId={'player1'}
    members={['player1', 'player2']}
    startGame={jest.fn()}
    onRoundSettingsChange={onRoundSettingsChange}
    roomState={workerRoomState()}
  />);

  fireEvent.change(screen.getByTestId('sb-input'), {target: {value: '5'}});

  await waitFor(() => {
    expect(onRoundSettingsChange).toHaveBeenLastCalledWith(expect.objectContaining({
      smallBlindAmount: 5,
      bigBlindAmount: 6,
    }));
  });
});

test('keeps the host auto-fold timeout without capping it at 300 seconds', async () => {
  const onRoundSettingsChange = jest.fn();
  render(<Staging
    round={undefined}
    playerId={'player1'}
    members={['player1', 'player2']}
    startGame={jest.fn()}
    onRoundSettingsChange={onRoundSettingsChange}
    roomState={workerRoomState()}
  />);

  fireEvent.change(screen.getByTestId('auto-fold-timeout-input'), {target: {value: '500'}});

  await waitFor(() => {
    expect(onRoundSettingsChange).toHaveBeenLastCalledWith(expect.objectContaining({
      autoFoldTimeoutSeconds: 500,
    }));
  });
});

test('does not broadcast NaN while a numeric setup field is temporarily empty', async () => {
  const onRoundSettingsChange = jest.fn();
  render(<Staging
    round={undefined}
    playerId={'player1'}
    members={['player1', 'player2']}
    startGame={jest.fn()}
    onRoundSettingsChange={onRoundSettingsChange}
    roomState={workerRoomState()}
  />);

  await waitFor(() => expect(onRoundSettingsChange).toHaveBeenCalled());
  onRoundSettingsChange.mockClear();

  fireEvent.change(screen.getByTestId('auto-fold-timeout-input'), {target: {value: ''}});

  expect(onRoundSettingsChange).not.toHaveBeenCalled();
  expect(screen.getByTestId('start-button')).toBeDisabled();

  fireEvent.change(screen.getByTestId('auto-fold-timeout-input'), {target: {value: '500'}});

  await waitFor(() => {
    expect(onRoundSettingsChange).toHaveBeenLastCalledWith(expect.objectContaining({
      autoFoldTimeoutSeconds: 500,
    }));
  });
  expect(screen.getByTestId('start-button')).toBeEnabled();
});

test('passes 1024-bit encryption by default when starting', () => {
  const startGame = jest.fn();
  render(<Staging
    round={undefined}
    playerId={'player1'}
    members={['player1', 'player2']}
    startGame={startGame}
    roomState={workerRoomState()}
  />);

  fireEvent.click(screen.getByTestId('start-button'));

  expect(startGame).toHaveBeenCalledWith(expect.objectContaining({
    bits: 1024,
  }));
});

test('starts directly without showing the legal acknowledgement modal', () => {
  const startGame = jest.fn();
  render(<Staging
    round={undefined}
    playerId={'player1'}
    members={['player1', 'player2']}
    startGame={startGame}
    roomState={workerRoomState()}
  />);

  expect(screen.queryByTestId('legal-start-modal')).toBeNull();
  fireEvent.click(screen.getByTestId('start-button'));
  expect(startGame).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('legal-start-modal')).toBeNull();
});

test('shows encrypted shuffle progress only when a real shuffle is in progress (no optimistic flash on click)', () => {
  const startGame = jest.fn();
  const {rerender} = render(<Staging
    round={undefined}
    playerId={'player1'}
    members={['player1', 'player2']}
    names={new Map([['player2', 'Alice']])}
    startGame={startGame}
    roomState={workerRoomState()}
  />);

  // Clicking start no longer flashes an optimistic overlay — the animation is
  // driven solely by the real shuffle transcript (the parent's shuffleOverlayStartedAt).
  fireEvent.click(screen.getByTestId('start-button'));
  expect(startGame).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('shuffle-overlay')).toBeNull();

  // Once a real shuffle is in progress, the parent passes shuffleOverlayStartedAt and the overlay shows.
  rerender(<Staging
    round={undefined}
    playerId={'player1'}
    members={['player1', 'player2']}
    names={new Map([['player2', 'Alice']])}
    startGame={startGame}
    roomState={workerRoomState()}
    shuffleOverlayStartedAt={Date.now()}
  />);
  expect(screen.getByTestId('shuffle-overlay')).toHaveTextContent('正在加密洗牌');
  expect(screen.getByTestId('shuffle-overlay')).toHaveTextContent('我 正在加密并洗牌');
});

test('shows the (read-only) disconnect/timeout explanation on the host setup page', () => {
  render(<Staging
    round={undefined}
    playerId={'player1'}
    members={['player1', 'player2']}
    startGame={jest.fn()}
    roomState={workerRoomState()}
  />);

  // The standing disconnect-rules panel was removed from setup — those rules are
  // shown only in the pause panel, when a disconnect actually happens.
  expect(screen.queryByTestId('disconnect-rules-panel')).toBeNull();
  expect(screen.getByTestId('auto-fold-timeout-input')).toBeInTheDocument();
});

test('blocks setup controls when the worker has an active hand', () => {
  const startGame = jest.fn();
  const onReturnToTable = jest.fn();
  render(<Staging
    round={undefined}
    playerId={'player1'}
    members={['player1', 'player2', 'player3']}
    startGame={startGame}
    onReturnToTable={onReturnToTable}
    roomState={workerRoomState({
      currentRound: 3,
      currentPlayers: ['player2', 'player3'],
      players: [
        {peerId: 'player1', online: true, connected: true, seated: true, status: 'active'},
        {peerId: 'player2', online: true, connected: true, seated: true, status: 'active'},
        {peerId: 'player3', online: true, connected: true, seated: true, status: 'active'},
      ],
      activePlayerCount: 3,
      onlineCount: 3,
    })}
  />);

  expect(screen.getByTestId('staging-active-hand')).toHaveTextContent('牌局正在进行');
  expect(screen.queryByTestId('start-button')).toBeNull();
  expect(screen.queryByTestId('planned-rounds-input')).toBeNull();
  fireEvent.click(screen.getByTestId('active-hand-return-button'));
  expect(onReturnToTable).toHaveBeenCalledTimes(1);
  expect(startGame).not.toHaveBeenCalled();
});

test('shows return-to-table button on staging when current player timed out', () => {
  const onReturnToTable = jest.fn();
  render(<Staging
    round={undefined}
    playerId={'player1'}
    members={['player1', 'player2']}
    startGame={jest.fn()}
    onReturnToTable={onReturnToTable}
    roomState={workerRoomState({
      players: [
        {peerId: 'player1', online: true, connected: true, seated: false, status: 'timedOut', timedOut: true},
        {peerId: 'player2', online: true, connected: true, seated: true, status: 'active'},
      ],
      activePlayerCount: 1,
      playable: false,
      reason: 'waiting-for-seated-player',
    })}
  />);

  expect(screen.getByTestId('staging-return-panel')).toHaveTextContent('操作超时');
  expect(screen.getByTestId('staging-return-panel')).toHaveTextContent('本局已自动弃牌');
  expect(screen.getByTestId('return-to-table-button')).toHaveTextContent('重新坐下');
  fireEvent.click(screen.getByTestId('return-to-table-button'));
  expect(onReturnToTable).toHaveBeenCalledTimes(1);
});

test('finished hand shows a simple next-hand countdown', () => {
  const startGame = jest.fn();
  render(<Staging
    round={1}
    playerId={'player2'}
    members={['player1', 'player2']}
    startGame={startGame}
    roundSettings={{initialFundAmount: 100, plannedRounds: 3, seriesStartRound: 1}}
    seriesProgress={{current: 1, total: 3, complete: false}}
    roomState={workerRoomState()}
  />);

  expect(screen.getByTestId('next-hand-countdown')).toHaveTextContent('5 秒后自动发牌');
  expect(screen.queryByTestId('continue-button')).toBeNull();
  expect(startGame).not.toHaveBeenCalled();
  expect(screen.queryByTestId('series-progress-card')).toBeNull();
});

test('finished hand asks the table shell to start the next hand after countdown', () => {
  jest.useFakeTimers();
  const startGame = jest.fn();
  const onNextHandCountdownComplete = jest.fn();
  try {
    render(<Staging
      round={1}
      playerId={'player2'}
      members={['player1', 'player2']}
      startGame={startGame}
      roundSettings={{initialFundAmount: 100, plannedRounds: 3, seriesStartRound: 1}}
      seriesProgress={{current: 1, total: 3, complete: false}}
      onNextHandCountdownComplete={onNextHandCountdownComplete}
      roomState={workerRoomState()}
    />);

    expect(screen.queryByTestId('continue-button')).toBeNull();

    act(() => {
      jest.advanceTimersByTime(5500);
    });

    expect(screen.queryByTestId('next-hand-countdown')).toBeNull();
    expect(screen.queryByTestId('shuffle-overlay')).toBeNull();
    expect(startGame).not.toHaveBeenCalled();
    expect(onNextHandCountdownComplete).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test('finished hand shows a recovery button if the next hand has not started after the countdown', () => {
  jest.useFakeTimers();
  const startGame = jest.fn();
  const onNextHandCountdownComplete = jest.fn();
  try {
    render(<Staging
      round={1}
      playerId={'player1'}
      members={['player1', 'player2']}
      startGame={startGame}
      roundSettings={{initialFundAmount: 100, plannedRounds: 3, seriesStartRound: 1}}
      seriesProgress={{current: 1, total: 3, complete: false}}
      onNextHandCountdownComplete={onNextHandCountdownComplete}
      roomState={workerRoomState()}
    />);

    act(() => {
      jest.advanceTimersByTime(12000);
    });

    expect(screen.getByTestId('continue-button')).toBeVisible();
    fireEvent.click(screen.getByTestId('continue-button'));
    expect(startGame).not.toHaveBeenCalled();
    expect(onNextHandCountdownComplete).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});

test('finished hand shows request pending feedback after manual recovery is requested', () => {
  jest.useFakeTimers();
  const startGame = jest.fn();
  const onNextHandCountdownComplete = jest.fn();
  try {
    const {rerender} = render(<Staging
      round={1}
      playerId={'player1'}
      members={['player1', 'player2']}
      startGame={startGame}
      roundSettings={{initialFundAmount: 100, plannedRounds: 3, seriesStartRound: 1}}
      seriesProgress={{current: 1, total: 3, complete: false}}
      onNextHandCountdownComplete={onNextHandCountdownComplete}
      roomState={workerRoomState()}
    />);

    act(() => {
      jest.advanceTimersByTime(12000);
    });

    fireEvent.click(screen.getByTestId('continue-button'));
    rerender(<Staging
      round={1}
      playerId={'player1'}
      members={['player1', 'player2']}
      startGame={startGame}
      roundSettings={{initialFundAmount: 100, plannedRounds: 3, seriesStartRound: 1}}
      seriesProgress={{current: 1, total: 3, complete: false}}
      nextHandRecoveryRequested
      onNextHandCountdownComplete={onNextHandCountdownComplete}
      roomState={workerRoomState()}
    />);

    expect(screen.getByTestId('next-hand-countdown')).toHaveTextContent('已请求，正在重试');
    expect(screen.getByTestId('continue-button')).toBeEnabled();
  } finally {
    jest.useRealTimers();
  }
});

test('finished hand uses the parent shuffle overlay when a next hand is actually starting', () => {
  jest.useFakeTimers();
  const startGame = jest.fn();
  try {
    render(<Staging
      round={1}
      playerId={'player2'}
      members={['player2', 'player1']}
      players={['player1', 'player2']}
      startGame={startGame}
      roundSettings={{initialFundAmount: 100, plannedRounds: 3, seriesStartRound: 1}}
      seriesProgress={{current: 1, total: 3, complete: false}}
      shuffleOverlayStartedAt={Date.now()}
      roomState={workerRoomState()}
    />);

    expect(screen.queryByTestId('next-hand-countdown')).toBeNull();
    expect(screen.getByTestId('shuffle-overlay')).toHaveTextContent('正在加密洗牌');
    expect(screen.queryByTestId('continue-button')).toBeNull();
    expect(startGame).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test('finished hand warns host when one more player is needed', () => {
  render(<Staging
    round={1}
    playerId={'player1'}
    members={['player1']}
    startGame={() => {}}
    roundSettings={{initialFundAmount: 100, plannedRounds: 3, seriesStartRound: 1}}
    seriesProgress={{current: 1, total: 3, complete: false}}
    roomState={workerRoomState({
      players: [
        {peerId: 'player1', online: true, connected: true, seated: true, status: 'active'},
      ],
      currentPlayers: ['player1'],
      activePlayerCount: 1,
      onlineCount: 1,
      playable: false,
      reason: 'waiting-for-online-player',
    })}
  />);

  expect(screen.getByText('牌桌已空')).toBeInTheDocument();
  expect(screen.getByText('请等待其他人入座。')).toBeInTheDocument();
  expect(screen.queryByTestId('next-hand-countdown')).toBeNull();
  expect(screen.queryByTestId('continue-button')).toBeNull();
});

test('completed match waits for the host restart instead of showing next-hand countdown', () => {
  const startGame = jest.fn();
  render(<Staging
    round={3}
    playerId={'player2'}
    members={['player1', 'player2']}
    startGame={startGame}
    roundSettings={{initialFundAmount: 100, plannedRounds: 3, seriesStartRound: 1}}
    seriesProgress={{current: 3, total: 3, complete: true}}
    roomState={workerRoomState()}
  />);

  expect(screen.queryByTestId('new-table-button')).not.toBeInTheDocument();
  expect(screen.getByText('牌局已完成')).toBeInTheDocument();
  expect(screen.queryByTestId('next-hand-countdown')).toBeNull();
  expect(screen.queryByTestId('continue-button')).toBeNull();
  expect(startGame).not.toHaveBeenCalled();
});
