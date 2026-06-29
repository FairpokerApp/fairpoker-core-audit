import {render, screen} from "@testing-library/react";
import CommunityCardsOnTable from "./CommunityCardsOnTable";
import {handRank} from "phe";

test('rendering does not crash', () => {
  render(<CommunityCardsOnTable potAmount={100} currentRoundFinished={false} board={[]}/>);
});

test('settled hand shows chip award instead of winner sentence', () => {
  render(<CommunityCardsOnTable
    potAmount={100}
    currentRoundFinished
    board={[]}
    lastWinningResult={{
      how: 'Showdown',
      round: 1,
      showdown: [{strength: 1, handValue: handRank(1), players: ['p1']}],
    }}
  />);

  expect(screen.queryByText(/赢下本局/)).toBeNull();
  expect(screen.getByLabelText('chips awarded')).toBeInTheDocument();
  expect(screen.queryByText('+$100')).toBeNull();
});

test('voided hand shows a clear voided banner instead of a stale pot', () => {
  render(<CommunityCardsOnTable
    potAmount={0}
    currentRoundFinished
    board={[]}
    lastWinningResult={{
      how: 'Voided',
      round: 1,
      missingPlayers: ['p2'],
      approvals: ['p1'],
    }}
  />);

  expect(screen.getByTestId('hand-voided-banner')).toBeInTheDocument();
  expect(screen.getByTestId('hand-voided-banner')).toHaveTextContent('本局作废');
  expect(screen.queryByTestId('pot')).toBeNull();
});
