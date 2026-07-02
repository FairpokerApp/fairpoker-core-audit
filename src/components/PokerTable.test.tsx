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

test('a VOIDED hand never pops the fairness check (an unfinished hand has nothing to prove fair, so no spinner can strand a peer)', () => {
  // The fairness overlay for a voided hand is what stranded the no-refresh peer on an endless
  // spinner (it waits on data the departed player will never send). A voided hand is skipped
  // synchronously, so the overlay must be absent immediately.
  render(<PokerTable
    {...baseProps}
    currentRoundFinished={true}
    lastWinningResult={{how: 'Voided', round: 1, missingPlayers: [], approvals: []}}
  />);
  expect(screen.queryByTestId('fairness-overlay')).toBeNull();
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

test('shows the shuffle overlay as a small toast without hiding the table', () => {
  // The encrypted shuffle is now a small non-blocking corner toast, so during a live hand the
  // table (pot / community-card area) stays visible behind it instead of being covered by a
  // full-screen overlay. This is the real shuffle moment: a new hand has started (round in
  // progress) while players' decks are being co-encrypted.
  render(<PokerTable
    {...baseProps}
    currentRoundFinished={false}
    shuffleOverlayStartedAt={Date.now()}
  />);
  expect(screen.getByTestId('shuffle-overlay')).toBeInTheDocument();
  expect(screen.getByTestId('pot')).toBeInTheDocument();
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
