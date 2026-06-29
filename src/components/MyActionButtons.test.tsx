import React from 'react';
import {render, screen} from '@testing-library/react';
import MyActionButtons from './MyActionButtons';
import {Board, Hole} from '../lib/rules';

const hole: Hole = [{suit: 'Spade', rank: 'A'}, {suit: 'Heart', rank: 'K'}];
const board: Board = [{suit: 'Club', rank: '2'}, {suit: 'Diamond', rank: '3'}, {suit: 'Heart', rank: '4'}];
const bankrolls = new Map([['player1', 1000], ['player2', 500]]);

const baseProps = {
  playerId: 'player1',
  players: ['player1', 'player2'],
  whoseTurnAndCallAmount: {whoseTurn: 'player1', callAmount: 0},
  hole,
  board,
  currentRoundFinished: false,
  potAmount: 100,
  bankrolls,
  fireBet: jest.fn(),
  fireFold: jest.fn(),
};

test('renders action buttons when it is my turn', () => {
  render(<MyActionButtons {...baseProps} />);
  expect(screen.getByTestId('check-or-call-action-button')).toBeInTheDocument();
});

test('does not render the old inline auto-fold countdown warning', () => {
  const play = jest.fn();
  render(<MyActionButtons {...baseProps} autoFoldTimeoutSeconds={10} audio={{play}} />);

  expect(screen.queryByTestId('auto-fold-countdown')).toBeNull();
  expect(play).not.toHaveBeenCalled();
});

test('renders nothing when playerId is undefined', () => {
  const {container} = render(<MyActionButtons {...baseProps} playerId={undefined} />);
  expect(container.innerHTML).toBe('');
});

test('renders nothing when it is not my turn', () => {
  const {container} = render(
    <MyActionButtons {...baseProps} whoseTurnAndCallAmount={{whoseTurn: 'player2', callAmount: 0}} />
  );
  expect(container.innerHTML).toBe('');
});

test('renders nothing when round is finished', () => {
  const {container} = render(<MyActionButtons {...baseProps} currentRoundFinished={true} />);
  expect(container.innerHTML).toBe('');
});

test('explains local key restore when it is my turn but hole is undefined', () => {
  render(<MyActionButtons {...baseProps} hole={undefined} />);
  expect(screen.getByText('正在恢复本手牌密钥')).toBeInTheDocument();
  expect(screen.getByText('正在恢复本地手牌密钥')).toBeInTheDocument();
});

test('explains when this browser is not one of the current hand players', () => {
  render(<MyActionButtons {...baseProps} playerId="spectator" isRejoinBlocked={true} />);
  expect(screen.getByText('你已暂离本手')).toBeInTheDocument();
  expect(screen.getByText('本手已经不能重新加入。请点击“回到桌上”，下一手开始时会自动重新入座。')).toBeInTheDocument();
  expect(screen.queryByText('当前浏览器不是本手牌玩家')).not.toBeInTheDocument();
});

test('renders nothing when players is undefined', () => {
  const {container} = render(<MyActionButtons {...baseProps} players={undefined} />);
  expect(container.innerHTML).toBe('');
});

test('renders nothing when whoseTurnAndCallAmount is null', () => {
  const {container} = render(<MyActionButtons {...baseProps} whoseTurnAndCallAmount={null} />);
  expect(container.innerHTML).toBe('');
});
