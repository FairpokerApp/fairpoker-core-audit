import React from 'react';
import {render, screen} from '@testing-library/react';
import CardImage from "./CardImage";

test('rendering does not crash', () => {
  render(<CardImage/>);
});

test('rendering with a card property', () => {
  render(<CardImage card={{ suit: 'Club', rank: 'A' }}/>);
});

test('invalid runtime card data renders as card back instead of crashing', () => {
  render(<CardImage card={1.8916318659736983e+153 as any} data-testid="card" />);
  expect(screen.getByTestId('card')).toHaveClass('card-back');
  expect(screen.getByTestId('card')).toHaveAttribute('aria-label', 'Back');
});
