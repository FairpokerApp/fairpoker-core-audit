import React from 'react';
import {render, screen} from '@testing-library/react';
import TexasHoldemUiPreview from './TexasHoldemUiPreview';

function renderPreview(state: string) {
  window.history.pushState({}, '', `/?uiPreview=${state}`);
  return render(<TexasHoldemUiPreview />);
}

test('final planned hand still shows live table controls until the hand is settled', () => {
  renderPreview('final-hand-live');

  expect(screen.getByTestId('opponents')).toBeVisible();
  expect(screen.getByTestId('check-or-call-action-button')).toBeVisible();
  expect(screen.getByTestId('fold-action-button')).toBeVisible();
  expect(screen.queryByTestId('new-table-button')).not.toBeInTheDocument();
});

test('completed planned match shows the final report without an automatic next-hand countdown', () => {
  renderPreview('match-complete');

  expect(screen.queryByTestId('new-table-button')).not.toBeInTheDocument();
  expect(screen.queryByTestId('next-hand-countdown')).toBeNull();
  expect(screen.queryByTestId('continue-button')).not.toBeInTheDocument();
  expect(screen.getAllByText('本轮战局总报表').length).toBeGreaterThan(0);
  expect(screen.getByTestId('score-board-new-table-button')).toHaveTextContent('重新开局');
});

test('seat recovery explains automatic next hand rejoin without a reload button', () => {
  renderPreview('seat-lost');

  expect(screen.getByTestId('seat-recovery-panel')).toHaveTextContent('你已暂离牌桌');
  expect(screen.getByTestId('seat-recovery-panel')).toHaveTextContent('请重新坐下，等待其他人入座');
  expect(screen.getByTestId('return-to-table-button')).toHaveTextContent('回到桌上');
  expect(screen.queryByTestId('reseat-button')).not.toBeInTheDocument();
});

test('spectator rail preview separates watching and queued players', () => {
  renderPreview('spectator-rail');

  expect(screen.getByTestId('spectator-rail')).toHaveTextContent('观战区');
  expect(screen.getByTestId('spectator-rail')).toHaveTextContent('Bruno');
  expect(screen.getByTestId('spectator-rail')).toHaveTextContent('观战中');
  expect(screen.getByTestId('spectator-rail')).toHaveTextContent('Carmen');
  expect(screen.getByTestId('spectator-rail')).toHaveTextContent('等待开局');
});

test('queued next hand preview shows a disabled waiting button', () => {
  renderPreview('queued-next-hand');

  expect(screen.getByTestId('seat-recovery-panel')).toHaveTextContent('正在等待开局');
  expect(screen.getByTestId('seat-recovery-panel')).toHaveTextContent('请等待其他人入座');
  expect(screen.getByTestId('return-to-table-button')).toBeDisabled();
});

test('registration lobby preview shows join match and rail list', () => {
  renderPreview('registration-lobby');

  expect(screen.getByTestId('staging')).toHaveTextContent('加入战局');
  expect(screen.getByTestId('staging-rail-list')).toHaveTextContent('观战区');
  expect(screen.getByTestId('start-button')).toBeEnabled();
});
