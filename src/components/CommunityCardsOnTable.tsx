import {WinningResult} from "../lib/texas-holdem/TexasHoldemGameRoom";
import {Board} from "../lib/rules";
import ChipImage from "./ChipImage";
import React from "react";
import CommunityCards from "./CommunityCards";
import {useI18n} from "../lib/i18n";

export default function CommunityCardsOnTable(props: {
  potAmount: number;
  currentRoundFinished: boolean;
  lastWinningResult?: WinningResult;
  board: Board;
}) {
  const {t} = useI18n();
  const {
    potAmount,
    currentRoundFinished,
    lastWinningResult: winningResult,
    board,
  } = props;
  const voided = currentRoundFinished && winningResult?.how === 'Voided';
  const winners = currentRoundFinished && winningResult
    ? winningResult.how === 'Showdown'
      ? winningResult.showdown[0].players
      : winningResult.how === 'LastOneWins'
        ? [winningResult.winner]
        : []
    : [];
  return (
    <>
      {voided ? (
        // A voided hand pays nothing — show why it ended instead of a stale "$0",
        // so the next hand never feels like it started out of nowhere.
        <div className="pot pot-result pot-void" data-testid="hand-voided-banner" role="status">
          <strong>{t('handVoidedShort')}</strong>
          <span>{t('handVoidedRefunded')}</span>
        </div>
      ) : (
        <div className={winners.length > 0 ? 'pot pot-result pot-chip-award' : 'pot'} data-testid="pot">
          {
            winners.length > 0 ? (
              <div className="chip-award" aria-label="chips awarded">
                <div className="chip-award-stack" aria-hidden="true">
                  <ChipImage className="chip-award-chip chip-award-chip-one" />
                  <ChipImage className="chip-award-chip chip-award-chip-two" />
                  <ChipImage className="chip-award-chip chip-award-chip-three" />
                </div>
              </div>
            ) : (
              <><ChipImage/> ${potAmount}</>
            )
          }
        </div>
      )}
      <CommunityCards board={board}/>
    </>
  );
}
