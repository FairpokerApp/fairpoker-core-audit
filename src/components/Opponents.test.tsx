import React from 'react';
import {act, fireEvent, render, screen, within} from '@testing-library/react';
import Opponents from './Opponents';
import {Board, Hole} from '../lib/rules';
import {RelayPeerProfile, WorkerRoomState} from '../lib/CloudflareRelayTransport';

const board: Board = [{suit: 'Club', rank: '2'}, {suit: 'Diamond', rank: '3'}, {suit: 'Heart', rank: '4'}];

const baseProps = {
  members: ['p1', 'p2', 'p3'],
  playerId: 'p1',
  players: undefined as string[] | undefined,
  names: new Map([['p1', 'Alice'], ['p2', 'Bob'], ['p3', 'Charlie']]),
  bankrolls: new Map([['p1', 1000], ['p2', 500], ['p3', 300]]),
  board,
  whoseTurn: undefined as string | undefined,
  holesPerPlayer: undefined as Map<string, Hole> | undefined,
  mainPotWinners: null,
  actionsDone: null,
};

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

function workerRoomState(overrides: Partial<WorkerRoomState> = {}): WorkerRoomState {
  return {
    version: 1,
    source: 'cloudflare-worker',
    roomId: 'table-test',
    generatedAt: Date.now(),
    viewerPeerId: 'p1',
    latestEventSeq: 1,
    currentRound: 1,
    currentPlayers: ['p1', 'p2', 'p3'],
    currentTurn: null,
    players: [
      {peerId: 'p1', online: true, connected: true, seated: true, status: 'active'},
      {peerId: 'p2', online: false, connected: false, seated: false, status: 'offline'},
      {peerId: 'p3', online: true, connected: true, seated: true, status: 'active'},
    ],
    activePlayerCount: 2,
    onlineCount: 2,
    roomValid: true,
    playable: true,
    reason: 'ready',
    ...overrides,
  };
}

test('renders opponents from members when players is undefined (lobby state)', () => {
  render(<Opponents {...baseProps} />);
  expect(screen.getByTestId('opponents')).toBeInTheDocument();
  expect(screen.getByTestId('opponent-0')).toBeInTheDocument();
  expect(screen.getByTestId('opponent-1')).toBeInTheDocument();
});

test('excludes self from opponents when using members', () => {
  render(<Opponents {...baseProps} />);
  // p1 is self, p2 and p3 are opponents = 2 opponents
  expect(screen.queryByTestId('opponent-2')).toBeNull();
});

test('circular reorder: opponents start after my position', () => {
  // players order is [p2, p1, p3]. p1 is at index 1.
  // slice(2) = [p3], slice(0,1) = [p2] → opponents = [p3, p2] (Charlie, Bob)
  // This verifies the circular slicing logic produces a different order than the input
  render(<Opponents {...baseProps} players={['p2', 'p1', 'p3']} />);
  const opponent0 = screen.getByTestId('opponent-0');
  const opponent1 = screen.getByTestId('opponent-1');
  expect(within(opponent0).getByText('Charlie')).toBeInTheDocument(); // p3 sits after p1
  expect(within(opponent1).getByText('Bob')).toBeInTheDocument();     // p2 wraps around
});

test('falls back to full player list when playerId not in players', () => {
  // myOffset < 0 branch: playerId is not in the players array
  render(<Opponents {...baseProps} playerId="unknown" players={['p1', 'p2', 'p3']} />);
  // All 3 players should render as opponents since "unknown" is not among them
  expect(screen.getByTestId('opponent-0')).toBeInTheDocument();
  expect(screen.getByTestId('opponent-1')).toBeInTheDocument();
  expect(screen.getByTestId('opponent-2')).toBeInTheDocument();
});

test('highlights the opponent whose turn it is', () => {
  const {container} = render(
    <Opponents {...baseProps} players={['p1', 'p2', 'p3']} whoseTurn="p2" />
  );
  const highlighted = container.querySelector('.highlight');
  expect(highlighted).toBeInTheDocument();
});

test('shows a turn timer on the opponent whose turn it is', () => {
  render(
    <Opponents {...baseProps} players={['p1', 'p2', 'p3']} whoseTurn="p2" autoFoldTimeoutSeconds={20} />
  );

  expect(screen.getByTestId('turn-timer-badge')).toHaveTextContent('20');
});

test('does not apply winner frame to winning opponent', () => {
  const {container} = render(
    <Opponents {...baseProps} players={['p1', 'p2', 'p3']} mainPotWinners={new Set(['p2'])} />
  );
  expect(container.querySelector('.opponent.winner')).toBeNull();
});

test('does not apply winner class when no winners', () => {
  const {container} = render(
    <Opponents {...baseProps} players={['p1', 'p2', 'p3']} />
  );
  expect(container.querySelector('.opponent.winner')).toBeNull();
});

test('renders bankrolls for opponents', () => {
  render(<Opponents {...baseProps} players={['p1', 'p2', 'p3']} />);
  expect(screen.getByText('$500')).toBeInTheDocument();
  expect(screen.getByText('$300')).toBeInTheDocument();
});

test('shows a static red heartbeat for an opponent who left the relay', () => {
  const {container} = render(
    <Opponents {...baseProps} members={['p1', 'p3']} players={['p1', 'p2', 'p3']} roomState={workerRoomState()} />
  );

  expect(container.querySelector('.avatar-heartbeat-offline')).toBeInTheDocument();
});

test('opens opponent environment details from avatar', () => {
  sessionStorage.clear();
  render(<Opponents {...baseProps} players={['p1', 'p2', 'p3']} />);
  fireEvent.click(screen.getAllByLabelText('查看对手环境细节')[0]);
  expect(screen.getByTestId('opponent-risk-modal')).toHaveClass('visible');
  expect(screen.getAllByText(/对手环境/).length).toBeGreaterThan(0);
  expect(screen.getByTestId('peer-risk-details')).toBeInTheDocument();
  expect(screen.getByTestId('risk-profile-unavailable')).toHaveTextContent('暂无对手环境资料');
});

test('opponent environment details use local score when profile arrived before backend score', () => {
  sessionStorage.clear();
  render(<Opponents {...baseProps} members={['p1', 'p2']} players={['p1', 'p2']} />);

  act(() => {
    window.dispatchEvent(new CustomEvent('fairpoker:peer-profiles', {
      detail: {
        profiles: [
          profile('p1'),
          profile('p2'),
        ],
      },
    }));
  });

  fireEvent.click(screen.getAllByLabelText('查看对手环境细节')[0]);

  expect(screen.queryByText('等待评分')).not.toBeInTheDocument();
  expect(screen.queryByText('评分尚未返回')).not.toBeInTheDocument();
  expect(screen.getByText('暂未发现明显风险')).toBeInTheDocument();
  expect(screen.getByText('语言与时区一致')).toBeInTheDocument();
});

test('renders opponent hole cards during showdown', () => {
  const holesPerPlayer = new Map<string, Hole>([
    ['p2', [{suit: 'Spade', rank: 'A'}, {suit: 'Heart', rank: 'K'}]],
  ]);
  render(
    <Opponents {...baseProps} players={['p1', 'p2', 'p3']} holesPerPlayer={holesPerPlayer} />
  );
  // Each opponent gets 2 CardImage components (hand-card-0 and hand-card-1)
  const handCard0s = screen.getAllByTestId('hand-card-0');
  expect(handCard0s.length).toBe(2);
});

test('shows compact hand rank and chip delta after showdown', () => {
  const holesPerPlayer = new Map<string, Hole>([
    ['p2', [{suit: 'Spade', rank: 'A'}, {suit: 'Heart', rank: 'K'}]],
  ]);
  render(
    <Opponents
      {...baseProps}
      players={['p1', 'p2']}
      holesPerPlayer={holesPerPlayer}
      currentRoundFinished
      scoreBoard={new Map([['p2', 40]])}
      lastWinningResult={{
        how: 'Showdown',
        round: 1,
        showdown: [{strength: 1, handValue: 1, players: ['p2']}],
      }}
    />
  );

  expect(screen.getByTestId('hand-rank-badge')).toBeInTheDocument();
  expect(screen.getByTestId('chip-delta')).toHaveTextContent('+$40');
});

test('renders bet amounts when actionsDone is provided', () => {
  const actionsDone = new Map<string, string | number>([['p2', 50], ['p3', 'fold']]);
  render(
    <Opponents {...baseProps} players={['p1', 'p2', 'p3']} actionsDone={actionsDone} />
  );
  const betAmounts = screen.getAllByTestId('bet-amount');
  expect(betAmounts.length).toBe(2);
});

test('renders nothing when playerId is undefined and players is undefined', () => {
  const {container} = render(
    <Opponents {...baseProps} playerId={undefined} players={undefined} />
  );
  expect(container.querySelector('[data-testid="opponents"]')).toBeNull();
});
