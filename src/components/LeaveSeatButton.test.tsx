import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import LeaveSeatButton from './LeaveSeatButton';

test('leaves the seat directly without a blocking browser confirmation', async () => {
  const onLeaveSeat = jest.fn().mockResolvedValue(undefined);

  render(<LeaveSeatButton onLeaveSeat={onLeaveSeat} />);
  fireEvent.click(screen.getByTestId('leave-seat-button'));

  await waitFor(() => expect(onLeaveSeat).toHaveBeenCalledTimes(1));
});

test('disabled button cannot leave the seat', () => {
  const onLeaveSeat = jest.fn().mockResolvedValue(undefined);

  render(<LeaveSeatButton disabled onLeaveSeat={onLeaveSeat} />);
  fireEvent.click(screen.getByTestId('leave-seat-button'));

  expect(onLeaveSeat).not.toHaveBeenCalled();
});
