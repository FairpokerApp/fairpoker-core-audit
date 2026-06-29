import React from 'react';
import {render, screen} from '@testing-library/react';
import PokerTable from './PokerTable';
import {Board} from '../lib/rules';

const board: Board = [{suit: 'Club', rank: '2'}, {suit: 'Diamond', rank: '3'}, {suit: 'Heart', rank: '4'}];

const baseProps = {
  members: ['p1', 'p2'],
  playerId: 'p1',
  players: ['p1', 'p2'] as string[] | undefined,
  round: 1,
  board,
  potAmount: 200,
  currentRoundFinished: false,
  lastWinningResult: undefined,
  startGame: jest.fn().mockResolvedValue(undefined),
};

test('renders community cards when players and board exist', () => {
  render(<PokerTable {...baseProps} />);
  expect(screen.getByTestId('pot')).toBeInTheDocument();
});

test('does not render community cards when players is undefined', () => {
  render(<PokerTable {...baseProps} players={undefined} />);
  expect(screen.queryByTestId('pot')).toBeNull();
});

test('renders staging area when round is finished', () => {
  render(<PokerTable {...baseProps} currentRoundFinished={true} />);
  expect(screen.getByTestId('staging')).toBeInTheDocument();
});

test('hides community card backs on the setup screen', () => {
  render(<PokerTable {...baseProps} board={[]} currentRoundFinished={true} />);
  expect(screen.getByTestId('staging')).toBeInTheDocument();
  expect(screen.queryByTestId('pot')).toBeNull();
  expect(screen.queryByTestId('board-card-0')).toBeNull();
});

test('keeps the original table layout during showdown settlement', () => {
  render(<PokerTable
    {...baseProps}
    currentRoundFinished={true}
    lastWinningResult={{
      how: 'Showdown',
      round: 1,
      showdown: [
        {strength: 1, handValue: 1, players: ['p1']},
        {strength: 2, handValue: 2, players: ['p2']},
      ],
    }}
  />);
  expect(screen.getByTestId('staging')).toBeInTheDocument();
  expect(screen.getByTestId('table')).not.toHaveClass('table-staging');
});

test('keeps the original table layout during fold-win settlement', () => {
  render(<PokerTable
    {...baseProps}
    currentRoundFinished={true}
    lastWinningResult={{
      how: 'LastOneWins',
      round: 1,
      winner: 'p1',
    }}
  />);
  expect(screen.getByTestId('staging')).toBeInTheDocument();
  expect(screen.getByTestId('table')).not.toHaveClass('table-staging');
  expect(screen.getByLabelText('chips awarded')).toBeInTheDocument();
});

test('does not render staging when a higher priority recovery panel is active', () => {
  render(<PokerTable {...baseProps} currentRoundFinished={true} suppressStaging />);
  expect(screen.queryByTestId('staging')).toBeNull();
});

test('keeps community cards visible while a completed match waits for host restart', () => {
  render(<PokerTable
    {...baseProps}
    currentRoundFinished={true}
    seriesProgress={{current: 10, total: 10, complete: true}}
  />);
  expect(screen.getByTestId('staging')).toHaveTextContent('牌局已完成');
  expect(screen.queryByTestId('next-hand-countdown')).toBeNull();
  expect(screen.getByTestId('pot')).toBeVisible();
});

test('hides community cards behind the shuffle overlay', () => {
  render(<PokerTable
    {...baseProps}
    currentRoundFinished={true}
    shuffleOverlayStartedAt={Date.now()}
  />);
  expect(screen.getByTestId('shuffle-overlay')).toBeInTheDocument();
  expect(screen.queryByTestId('pot')).toBeNull();
});

test('renders shuffle overlay outside the transformed table container', () => {
  render(<PokerTable
    {...baseProps}
    currentRoundFinished={true}
    shuffleOverlayStartedAt={Date.now()}
  />);
  const overlay = screen.getByTestId('shuffle-overlay');
  const table = screen.getByTestId('table');
  expect(table).not.toContainElement(overlay);
  expect(document.body).toContainElement(overlay);
});

test('does not render staging when round is in progress', () => {
  render(<PokerTable {...baseProps} currentRoundFinished={false} />);
  expect(screen.queryByTestId('staging')).toBeNull();
});

test('does not render staging when playerId is undefined (spectator)', () => {
  render(<PokerTable {...baseProps} playerId={undefined} currentRoundFinished={true} />);
  expect(screen.queryByTestId('staging')).toBeNull();
});
