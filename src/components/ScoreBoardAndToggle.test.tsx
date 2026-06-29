import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import ScoreBoardAndToggle from "./ScoreBoardAndToggle";
import {ShowdownResult, WinningResult} from "../lib/texas-holdem/TexasHoldemGameRoom";
import {evaluateStandardCards, Hole} from "../lib/rules";
import {handRank} from "phe";

describe('ScoreBoardAndToggle', () => {
  const scoreBoard = new Map<string, number>();
  scoreBoard.set('p1', -1);
  scoreBoard.set('p2', 1);

  const totalDebt = new Map<string, number>();
  scoreBoard.set('p1', 200);
  scoreBoard.set('p2', 100);

  const bankrolls = new Map<string, number>();
  scoreBoard.set('p1', -50);
  scoreBoard.set('p2', 150);

  const names = new Map<string, string>();
  names.set('p1', 'Alice');

  test('rendering does not crash', () => {
    render(<ScoreBoardAndToggle
      scoreBoard={scoreBoard}
      totalDebt={totalDebt}
      bankrolls={bankrolls}
      names={names}
      lastWinningResult={undefined}
      mainPotWinners={null}
      holesPerPlayer={undefined}
      board={[]}
    />);
  });

  test('rendering with winning result', () => {
    const lastWinningResult: WinningResult = {
      how: 'LastOneWins',
      round: 1,
      winner: 'player1',
    };
    const mainPotWinners = new Set<string>();
    const holesPerPlayer = new Map<string, Hole>();
    holesPerPlayer.set('player1', [
      {suit: 'Diamond', rank: 'A'},
      {suit: 'Spade', rank: 'A'},
    ]);
    holesPerPlayer.set('player2', [
      {suit: 'Diamond', rank: 'K'},
      {suit: 'Spade', rank: 'K'},
    ]);

    mainPotWinners.add('player1');
    render(<ScoreBoardAndToggle
      scoreBoard={scoreBoard}
      totalDebt={totalDebt}
      bankrolls={bankrolls}
      names={names}
      lastWinningResult={lastWinningResult}
      mainPotWinners={mainPotWinners}
      holesPerPlayer={holesPerPlayer}
      board={[
        {suit: 'Diamond', rank: 'Q'},
        {suit: 'Diamond', rank: 'J'},
        {suit: 'Diamond', rank: 'T'},
      ]}
      playerId="player1"
      currentRoundFinished
    />);

    expect(screen.getByText('你赢下本局：无人继续跟注')).toBeInTheDocument();
  });

  test('in-progress report does not announce a stale previous winner', () => {
    render(<ScoreBoardAndToggle
      scoreBoard={scoreBoard}
      totalDebt={totalDebt}
      bankrolls={bankrolls}
      names={names}
      scoreBoardDataTestId="score-board"
      lastWinningResult={{
        how: 'LastOneWins',
        round: 1,
        winner: 'player1',
      }}
      mainPotWinners={new Set(['player1'])}
      holesPerPlayer={undefined}
      board={[]}
      playerId="player1"
      currentRoundFinished={false}
    />);

    fireEvent.click(screen.getByTestId('score-board-toggle'));

    expect(screen.getByText('当前筹码概览')).toBeInTheDocument();
    expect(screen.getAllByText('本手进行中').length).toBeGreaterThan(0);
    expect(screen.queryByText('本手还在进行中，胜负尚未结算。')).not.toBeInTheDocument();
    expect(screen.queryByText('你赢下本局：无人继续跟注')).not.toBeInTheDocument();
  });

  test('final report can review previous hands and exposes evidence downloads', () => {
    render(<ScoreBoardAndToggle
      scoreBoard={scoreBoard}
      totalDebt={totalDebt}
      bankrolls={bankrolls}
      names={new Map([['player1', 'Alice'], ['player2', 'Bob']])}
      scoreBoardDataTestId="score-board"
      lastWinningResult={{
        how: 'LastOneWins',
        round: 2,
        winner: 'player2',
      }}
      roundHistory={[
        {
          round: 1,
          players: ['player1', 'player2'],
          board: [
            {suit: 'Heart', rank: 'A'},
            {suit: 'Diamond', rank: '8'},
            {suit: 'Heart', rank: 'J'},
            {suit: 'Club', rank: '3'},
            {suit: 'Heart', rank: 'Q'},
          ],
          holesPerPlayer: new Map([
            ['player1', [{suit: 'Club', rank: '2'}, {suit: 'Diamond', rank: '3'}]],
            ['player2', [{suit: 'Spade', rank: 'K'}, {suit: 'Club', rank: 'J'}]],
          ]),
          winningResult: {
            how: 'LastOneWins',
            round: 1,
            winner: 'player1',
          },
        },
        {
          round: 2,
          players: ['player1', 'player2'],
          board: [
            {suit: 'Spade', rank: '2'},
            {suit: 'Spade', rank: '3'},
            {suit: 'Spade', rank: '4'},
            {suit: 'Diamond', rank: '5'},
            {suit: 'Club', rank: '6'},
          ],
          holesPerPlayer: new Map([
            ['player1', [{suit: 'Heart', rank: '7'}, {suit: 'Diamond', rank: '7'}]],
            ['player2', [{suit: 'Club', rank: 'A'}, {suit: 'Club', rank: 'K'}]],
          ]),
          winningResult: {
            how: 'LastOneWins',
            round: 2,
            winner: 'player2',
          },
        },
      ]}
      transcript={{
        version: 'fairpoker.transcript.v1',
        finalHash: 'sha256:abcdef1234567890',
        entries: [
          {
            index: 0,
            previousHash: 'sha256:genesis',
            eventHash: 'sha256:1',
            recordedAt: '2026-01-01T00:00:00.000Z',
            transportSender: 'player1',
            scope: 'public',
            signed: false,
            payloadHash: 'sha256:p1',
            wireEvent: {type: 'newRound', round: 1, players: ['player1', 'player2'], settings: {initialFundAmount: 100}},
          },
          {
            index: 1,
            previousHash: 'sha256:1',
            eventHash: 'sha256:2',
            recordedAt: '2026-01-01T00:00:01.000Z',
            transportSender: 'player2',
            scope: 'public',
            signed: false,
            payloadHash: 'sha256:p2',
            wireEvent: {type: 'newRound', round: 2, players: ['player1', 'player2'], settings: {initialFundAmount: 100}},
          },
        ],
      }}
      mainPotWinners={new Set(['player2'])}
      holesPerPlayer={undefined}
      board={[]}
      playerId="player1"
      matchComplete
    />);

    expect(screen.getByTestId('score-board')).toHaveTextContent('第 2 局');
    fireEvent.click(screen.getByTestId('score-board-round-1'));

    expect(screen.getByTestId('score-board-round-detail')).toHaveTextContent('第 1 局');
    expect(screen.getByTestId('score-board-round-detail')).toHaveTextContent('1 条证据事件');
    expect(screen.getByTestId('download-round-evidence')).toBeEnabled();
    expect(screen.getByTestId('download-match-evidence')).toBeEnabled();
  });

  test('rendering with showdown', () => {
    const strength = evaluateStandardCards([
      {suit: 'Diamond', rank: 'A'},
      {suit: 'Diamond', rank: 'K'},
      {suit: 'Diamond', rank: 'Q'},
      {suit: 'Diamond', rank: 'J'},
      {suit: 'Diamond', rank: 'T'},
    ])
    const handValue = handRank(strength);
    const lastWinningResult: ShowdownResult = {
      how: 'Showdown',
      round: 1,
      showdown: [
        {
          strength,
          handValue,
          players: ['player1'],
        }
      ]
    };
    const mainPotWinners = new Set<string>();
    mainPotWinners.add('player1');
    const holesPerPlayer = new Map<string, Hole>();
    holesPerPlayer.set('player1', [
      {suit: 'Diamond', rank: 'A'},
      {suit: 'Diamond', rank: 'K'},
    ]);
    holesPerPlayer.set('player2', [
      {suit: 'Diamond', rank: '2'},
      {suit: 'Spade', rank: '7'},
    ]);

    mainPotWinners.add('player1');
    render(<ScoreBoardAndToggle
      scoreBoard={scoreBoard}
      totalDebt={totalDebt}
      bankrolls={bankrolls}
      names={names}
      lastWinningResult={lastWinningResult}
      mainPotWinners={mainPotWinners}
      holesPerPlayer={holesPerPlayer}
      board={[
        {suit: 'Diamond', rank: 'Q'},
        {suit: 'Diamond', rank: 'J'},
        {suit: 'Diamond', rank: 'T'},
      ]}
      currentRoundFinished
    />);
  });

  test('showdown report includes losing players hole cards too', () => {
    const lastWinningResult: ShowdownResult = {
      how: 'Showdown',
      round: 1,
      showdown: [
        {
          strength: evaluateStandardCards([
            {suit: 'Spade', rank: 'A'},
            {suit: 'Heart', rank: 'A'},
            {suit: 'Diamond', rank: 'Q'},
            {suit: 'Club', rank: 'J'},
            {suit: 'Spade', rank: 'T'},
          ]),
          handValue: handRank(1),
          players: ['player1'],
        },
        {
          strength: evaluateStandardCards([
            {suit: 'Club', rank: 'K'},
            {suit: 'Diamond', rank: '7'},
            {suit: 'Diamond', rank: 'Q'},
            {suit: 'Club', rank: 'J'},
            {suit: 'Spade', rank: 'T'},
          ]),
          handValue: handRank(2),
          players: ['player2'],
        },
      ],
    };
    const holesPerPlayer = new Map<string, Hole>();
    holesPerPlayer.set('player1', [
      {suit: 'Spade', rank: 'A'},
      {suit: 'Heart', rank: 'A'},
    ]);
    holesPerPlayer.set('player2', [
      {suit: 'Club', rank: 'K'},
      {suit: 'Diamond', rank: '7'},
    ]);

    render(<ScoreBoardAndToggle
      scoreBoard={new Map([['player1', 2], ['player2', -2]])}
      totalDebt={totalDebt}
      bankrolls={bankrolls}
      names={new Map([['player1', 'Alice'], ['player2', 'Bob']])}
      scoreBoardDataTestId="score-board"
      lastWinningResult={lastWinningResult}
      mainPotWinners={new Set(['player1'])}
      holesPerPlayer={holesPerPlayer}
      board={[
        {suit: 'Diamond', rank: 'Q'},
        {suit: 'Club', rank: 'J'},
        {suit: 'Spade', rank: 'T'},
      ]}
      currentRoundFinished
    />);

    fireEvent.click(screen.getByTestId('score-board-toggle'));

    expect(screen.getByTestId('score-board')).toHaveTextContent('Alice');
    expect(screen.getByTestId('score-board')).toHaveTextContent('Bob');
    expect(screen.getAllByTestId('score-board-hand-card-0')).toHaveLength(2);
    expect(screen.getAllByTestId('score-board-hand-card-1')).toHaveLength(2);
  });

  test('rendering with showdown waits for enough visible cards before highlighting', () => {
    const lastWinningResult: ShowdownResult = {
      how: 'Showdown',
      round: 1,
      showdown: [
        {
          strength: 1,
          handValue: handRank(1),
          players: ['player1'],
        }
      ]
    };
    const holesPerPlayer = new Map<string, Hole>();
    holesPerPlayer.set('player1', [
      {suit: 'Diamond', rank: 'A'},
      {suit: 'Diamond', rank: 'K'},
    ]);

    render(<ScoreBoardAndToggle
      scoreBoard={scoreBoard}
      totalDebt={totalDebt}
      bankrolls={bankrolls}
      names={names}
      lastWinningResult={lastWinningResult}
      mainPotWinners={new Set(['player1'])}
      holesPerPlayer={holesPerPlayer}
      board={[]}
      currentRoundFinished
    />);

    expect(screen.getByTestId('score-board-toggle')).toBeInTheDocument();
  });

  test('opening and hiding the score board', async () => {
    render(<ScoreBoardAndToggle
      scoreBoard={scoreBoard}
      totalDebt={totalDebt}
      bankrolls={bankrolls}
      names={names}
      scoreBoardDataTestId="score-board"
      lastWinningResult={undefined}
      mainPotWinners={null}
      holesPerPlayer={undefined}
      board={[]}
    />);

    const scoreBoardComponent = await screen.findByTestId('score-board');
    expect(scoreBoardComponent.getAttribute('class')).not.toContain('visible');

    fireEvent.click(screen.getByTestId('score-board-toggle'));

    expect(scoreBoardComponent.getAttribute('class')).toContain('visible');

    fireEvent.click(scoreBoardComponent);
    expect(scoreBoardComponent.getAttribute('class')).not.toContain('visible');

    const toggle = await screen.findByTestId('score-board-toggle');
    fireEvent.click(toggle);
    expect(scoreBoardComponent.getAttribute('class')).toContain('visible');
  });

  test('closing the score board by clicking the close button', async () => {
    render(<ScoreBoardAndToggle
      scoreBoard={scoreBoard}
      totalDebt={totalDebt}
      bankrolls={bankrolls}
      names={names}
      scoreBoardDataTestId="score-board"
      lastWinningResult={undefined}
      mainPotWinners={null}
      holesPerPlayer={undefined}
      board={[]}
    />);

    fireEvent.click(screen.getByTestId('score-board-toggle'));

    const scoreBoardComponent = await screen.findByTestId('score-board');
    expect(scoreBoardComponent.getAttribute('class')).toContain('visible');

    fireEvent.click(screen.getByTestId('modal-close'));
    expect(scoreBoardComponent.getAttribute('class')).not.toContain('visible');
  });

  test('report modal does not contain the next-hand countdown', async () => {
    jest.useFakeTimers();
    try {
      render(<ScoreBoardAndToggle
        scoreBoard={scoreBoard}
        totalDebt={totalDebt}
        bankrolls={bankrolls}
        names={names}
        scoreBoardDataTestId="score-board"
        lastWinningResult={{
          how: 'LastOneWins',
          round: 1,
          winner: 'p2',
        }}
        mainPotWinners={new Set(['p2'])}
        holesPerPlayer={undefined}
        board={[]}
        playerId="p1"
        currentRoundFinished
      />);

      const scoreBoardComponent = await screen.findByTestId('score-board');
      expect(scoreBoardComponent.getAttribute('class')).not.toContain('visible');
      fireEvent.click(screen.getByTestId('score-board-toggle'));
      expect(scoreBoardComponent.getAttribute('class')).toContain('visible');
      expect(screen.getByText('本手结算报表')).toBeInTheDocument();
      expect(screen.queryByTestId('continue-button')).toBeNull();
      expect(screen.queryByTestId('next-hand-countdown')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  test('final match report opens automatically and lets the host restart', async () => {
    const onRestartMatch = jest.fn();
    render(<ScoreBoardAndToggle
      scoreBoard={scoreBoard}
      totalDebt={totalDebt}
      bankrolls={bankrolls}
      names={names}
      scoreBoardDataTestId="score-board"
      lastWinningResult={{
        how: 'LastOneWins',
        round: 10,
        winner: 'p2',
      }}
      mainPotWinners={new Set(['p2'])}
      holesPerPlayer={undefined}
      board={[]}
      playerId="p1"
      matchComplete
      canRestartMatch
      onRestartMatch={onRestartMatch}
    />);

    const scoreBoardComponent = await screen.findByTestId('score-board');
    expect(scoreBoardComponent.getAttribute('class')).toContain('visible');
    expect(screen.getAllByText('本轮战局总报表').length).toBeGreaterThan(0);
    expect(screen.getByText('本轮已打完。点击重新开局后，会先进入报名；所有人需要重新点“加入战局”。')).toBeInTheDocument();
    expect(screen.queryByText('你已弃牌，p2 赢下本局')).toBeNull();
    fireEvent.click(screen.getByTestId('score-board-new-table-button'));
    expect(onRestartMatch).toHaveBeenCalledTimes(1);
    expect(scoreBoardComponent.getAttribute('class')).not.toContain('visible');
  });

  test('final match report waits for host for non-host players', async () => {
    render(<ScoreBoardAndToggle
      scoreBoard={scoreBoard}
      totalDebt={totalDebt}
      bankrolls={bankrolls}
      names={names}
      scoreBoardDataTestId="score-board"
      lastWinningResult={{
        how: 'LastOneWins',
        round: 10,
        winner: 'p2',
      }}
      mainPotWinners={new Set(['p2'])}
      holesPerPlayer={undefined}
      board={[]}
      playerId="p1"
      matchComplete
      canRestartMatch={false}
    />);

    const scoreBoardComponent = await screen.findByTestId('score-board');
    expect(scoreBoardComponent.getAttribute('class')).toContain('visible');
    expect(screen.getByText('本轮已打完。请等待房主确认报表并重新开局。')).toBeInTheDocument();
    expect(screen.queryByTestId('score-board-new-table-button')).toBeNull();
  });
});
