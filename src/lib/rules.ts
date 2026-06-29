import {StandardCard} from "./secureMentalPoker";
import {combination} from "./utils";
import {evaluateCards} from "phe";

export const CARDS = 52;

export type Hole = [StandardCard, StandardCard];

export type Preflop = [];
export type Flop = [StandardCard, StandardCard, StandardCard];
export type Turn = [StandardCard, StandardCard, StandardCard, StandardCard];
export type River = [StandardCard, StandardCard, StandardCard, StandardCard, StandardCard];

export type Board =
  | Preflop
  | Flop
  | Turn
  | River
;

export function evaluateStandardCards(cards: StandardCard[]) {
  return evaluateCards(cards.map(card => card.rank + card.suit.charAt(0).toLowerCase()));
}

export function calculateEffectiveCardOffsets(
  boardAndHole: StandardCard[],
  strength: number,
  evaluate: (cards: StandardCard[]) => number = evaluateStandardCards,
): number[] | null {
  if (boardAndHole.length < 5 || boardAndHole.length > 7) {
    return null;
  }

  const fiveCardOffsetCandidates = combination(
    boardAndHole.map((_, offset) => offset),
    5,
  );

  for (let fiveCardOffsets of fiveCardOffsetCandidates) {
    const fiveCards = boardAndHole.filter((_, i) => fiveCardOffsets.includes(i));
    const eachStrength = evaluate(fiveCards);
    if (eachStrength === strength) {
      return fiveCardOffsets;
    }
  }
  return null;
}
