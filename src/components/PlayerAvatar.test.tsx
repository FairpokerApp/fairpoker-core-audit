import React from 'react';
import {render, screen} from '@testing-library/react';
import PlayerAvatar from "./PlayerAvatar";

test('rendering does not crash', () => {
  render(<PlayerAvatar playerId="player"/>);
});

test('rendering with player name', () => {
  render(<PlayerAvatar playerId="player" playerName="name"/>);
});

test('rendering with children', () => {
  render(<PlayerAvatar playerId="player">
    <span>foobar</span>
  </PlayerAvatar>);
});

test('renders turn countdown beside the avatar', () => {
  render(
    <PlayerAvatar
      playerId="player"
      playerName="name"
      turnTimer={{active: true, timeoutSeconds: 20, timerKey: 'turn-1'}}
    />
  );

  expect(screen.getByTestId('turn-timer-badge')).toHaveTextContent('20');
});
