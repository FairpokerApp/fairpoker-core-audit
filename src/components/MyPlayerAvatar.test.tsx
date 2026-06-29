import React from 'react';
import {render, screen, waitFor} from '@testing-library/react';
import MyPlayerAvatar, {buildDevicePlayerName} from './MyPlayerAvatar';

test('renders nothing when playerId is undefined', () => {
  const {container} = render(
    <MyPlayerAvatar playerId={undefined} names={new Map()} setMyName={jest.fn()} />
  );
  expect(container.innerHTML).toBe('');
});

test('shows an automatic device label when player has no name', async () => {
  const setMyName = jest.fn();
  render(
    <MyPlayerAvatar playerId="p1" names={new Map()} setMyName={setMyName} />
  );
  const deviceName = screen.getByTestId('my-device-name');
  expect(deviceName.textContent).toContain('· P1');
  await waitFor(() => expect(setMyName).toHaveBeenCalledWith(deviceName.textContent));
});

test('shows player name when name is set', () => {
  const names = new Map([['p1', 'Alice']]);
  render(
    <MyPlayerAvatar playerId="p1" names={names} setMyName={jest.fn()} />
  );
  expect(screen.getByText('Alice')).toBeInTheDocument();
});

test('automatic labels use registered username when available', () => {
  const label = buildDevicePlayerName('peer-abcdef12', 'Alice');
  expect(label).toBe('Alice');
});

test('member fallback labels use a local fingerprint', () => {
  const label = buildDevicePlayerName('peer-abcdef12');
  expect(label).toBe('会员 · EF12');
});
