import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import ActionButtons from "./ActionButtons";

test('rendering does not crash', () => {
  render(<ActionButtons
    potAmount={100}
    bankroll={30}
    callAmount={10}
    fireBet={() => {}}
    fireFold={() => {}}
  />);
});

test('check is displayed when callAmount is zero', () => {
  render(<ActionButtons
    potAmount={100}
    bankroll={30}
    callAmount={0}
    fireBet={() => {}}
    fireFold={() => {}}
  />);

  expect(screen.getByTestId('check-or-call-action-button')).toHaveTextContent('过牌');
});

test('call is displayed when callAmount is greater than zero', () => {
  render(<ActionButtons
    potAmount={100}
    bankroll={30}
    callAmount={1}
    fireBet={() => {}}
    fireFold={() => {}}
  />);

  expect(screen.getByTestId('check-or-call-action-button')).toHaveTextContent('跟注');
  expect(screen.getByTestId('check-or-call-action-button')).toHaveTextContent('$1');
});

test('raising half pot', () => {
  let amountBet: number | undefined;
  const fireBet = (amount: number) => {
    amountBet = amount;
  }
  const potAmount = 100;
  render(<ActionButtons
    potAmount={potAmount}
    bankroll={300}
    callAmount={1}
    fireBet={fireBet}
    fireFold={() => {}}
  />);

  const button = screen.getByTestId('raise-half-pot-action-button');
  expect(button).toBeVisible();
  fireEvent.click(button);

  expect(amountBet).toBe(potAmount / 2);
});

test('insufficient chips shows a friendly notice and does not bet', () => {
  const fireBet = jest.fn();
  render(<ActionButtons
    potAmount={100}
    bankroll={30}
    callAmount={1}
    fireBet={fireBet}
    fireFold={() => {}}
  />);

  fireEvent.click(screen.getByTestId('raise-half-pot-action-button'));

  expect(fireBet).not.toHaveBeenCalled();
  expect(screen.getByTestId('action-notice')).toHaveTextContent('筹码不足：需要 50');
});

test('raising half pot is not displayed', () => {
  render(<ActionButtons
    potAmount={100}
    bankroll={30}
    callAmount={51}
    fireBet={() => {}}
    fireFold={() => {}}
  />);

  expect(screen.queryByTestId('raise-half-pot-action-button')).toBeNull();
});

test('raising one pot', () => {
  let amountBet: number | undefined;
  const fireBet = (amount: number) => {
    amountBet = amount;
  }
  const potAmount = 100;
  render(<ActionButtons
    potAmount={potAmount}
    bankroll={300}
    callAmount={100}
    fireBet={fireBet}
    fireFold={() => {}}
  />);

  const button = screen.getByTestId('raise-1-pot-action-button');
  expect(button).toBeVisible();
  fireEvent.click(button);

  expect(amountBet).toBe(potAmount);
});

test('raising one pot is not displayed', () => {
  render(<ActionButtons
    potAmount={100}
    bankroll={30}
    callAmount={101}
    fireBet={() => {}}
    fireFold={() => {}}
  />);

  expect(screen.queryByTestId('raise-1-pot-action-button')).toBeNull();
});

test('raising double pot', () => {
  let amountBet: number | undefined;
  const fireBet = (amount: number) => {
    amountBet = amount;
  }
  const potAmount = 100;
  render(<ActionButtons
    potAmount={potAmount}
    bankroll={300}
    callAmount={200}
    fireBet={fireBet}
    fireFold={() => {}}
  />);

  const button = screen.getByTestId('raise-twice-pot-action-button');
  expect(button).toBeVisible();
  fireEvent.click(button);

  expect(amountBet).toBe(potAmount * 2);
});

test('raising double pot is not displayed', () => {
  render(<ActionButtons
    potAmount={100}
    bankroll={30}
    callAmount={201}
    fireBet={() => {}}
    fireFold={() => {}}
  />);

  expect(screen.queryByTestId('raise-twice-pot-action-button')).toBeNull();
});

test('all-in', () => {
  let amountBet: number | undefined;
  const fireBet = (amount: number) => {
    amountBet = amount;
  }
  render(<ActionButtons
    potAmount={100}
    bankroll={30}
    callAmount={31}
    fireBet={fireBet}
    fireFold={() => {}}
  />);

  const button = screen.getByTestId('all-in-action-button');
  expect(button).toBeVisible();
  fireEvent.click(button);
  expect(amountBet).toBe(30);
});

test('all-in with zero bankroll shows a friendly notice', () => {
  const fireBet = jest.fn();
  render(<ActionButtons
    potAmount={100}
    bankroll={0}
    callAmount={1}
    fireBet={fireBet}
    fireFold={() => {}}
  />);

  fireEvent.click(screen.getByTestId('all-in-action-button'));

  expect(fireBet).not.toHaveBeenCalled();
  expect(screen.getByTestId('action-notice')).toHaveTextContent('筹码不足。');
});

test('fold is displayed when callAmount is greater than zero', () => {
  let foldIsCalled = false;
  const fireFold = () => {
    foldIsCalled = true;
  };
  render(<ActionButtons
    potAmount={100}
    bankroll={30}
    callAmount={1}
    fireBet={() => {}}
    fireFold={fireFold}
  />);

  const foldButton = screen.getByTestId('fold-action-button');
  expect(foldButton).toBeVisible();
  fireEvent.click(foldButton);
  expect(foldIsCalled).toBeTruthy();
});

test('fold is not displayed when callAmount is zero', () => {
  render(<ActionButtons
    potAmount={100}
    bankroll={30}
    callAmount={0}
    fireBet={() => {}}
    fireFold={() => {}}
  />);

  expect(screen.queryByTestId('fold-action-button')).toBeNull();
});
