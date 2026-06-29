import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import SecurityStatusBar from './SecurityStatusBar';
import {GameAudioControls} from '../lib/useGameAudio';

const audio: GameAudioControls = {
  enabled: false,
  toggle: jest.fn(),
  play: jest.fn(),
  speak: jest.fn(),
};

function renderSecurityStatusBar() {
  render(<SecurityStatusBar
    peerState="PeerServerConnected"
    playerId="A"
    members={['A', 'B']}
    players={['A', 'B']}
    round={1}
    seriesProgress={{current: 1, total: 10, complete: false}}
    currentRoundFinished={false}
    boardCardsCount={0}
    whoseTurn="A"
    audio={audio}
  />);
}

test('security status panel opens and closes from the compact action', () => {
  renderSecurityStatusBar();

  fireEvent.click(screen.getByTestId('security-shield-button'));
  expect(screen.getByTestId('security-status-bar')).toBeInTheDocument();

  fireEvent.click(screen.getByTestId('security-status-close-button'));
  expect(screen.queryByTestId('security-status-bar')).not.toBeInTheDocument();
  expect(screen.getByTestId('security-shield-button')).toBeInTheDocument();
});
