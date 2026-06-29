import React from "react";
import {render, screen, fireEvent} from "@testing-library/react";
import HandPausePanel from "./HandPausePanel";
import {HandPauseState} from "../lib/texas-holdem/TexasHoldemGameRoom";

function makePause(): HandPauseState {
  return {
    round: 1,
    missingPlayers: ['peerB'],
    voters: ['peerA'],
    approvals: [],
    rejections: [],
    voidUnlockAtMs: Date.now() + 60_000,
  };
}

function renderPanel(onRefresh?: () => void) {
  return render(
    <HandPausePanel
      pause={makePause()}
      playerId="peerA"
      names={new Map([['peerB', '小明']])}
      onVote={() => {}}
      onRefresh={onRefresh}
    />,
  );
}

describe('HandPausePanel self-recovery refresh', () => {
  test('shows a 刷新重试 button + hint so a wrongly-stuck player can self-recover', () => {
    renderPanel(() => {});
    expect(screen.getByTestId('hand-pause-refresh-button')).toHaveTextContent('刷新重试');
    expect(screen.getByTestId('hand-pause-refresh-hint')).toBeInTheDocument();
  });

  test('clicking 刷新重试 calls the injected onRefresh (the reload self-recovery)', () => {
    const onRefresh = jest.fn();
    renderPanel(onRefresh);
    fireEvent.click(screen.getByTestId('hand-pause-refresh-button'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  test('the manual void button still renders alongside the new refresh button', () => {
    renderPanel(() => {});
    // The refresh self-recovery must not have removed the existing void-vote control.
    expect(screen.getByTestId('void-hand-approve-button')).toBeInTheDocument();
    expect(screen.getByTestId('hand-pause-refresh-button')).toBeInTheDocument();
  });
});
