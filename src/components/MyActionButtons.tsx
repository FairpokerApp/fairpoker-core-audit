import {Board, Hole} from "../lib/rules";
import React from "react";
import ActionButtons from "./ActionButtons";
import {GameAudioControls} from "../lib/useGameAudio";
import {useI18n} from "../lib/i18n";

export default function MyActionButtons(props: {
  playerId?: string;
  players?: string[];
  whoseTurnAndCallAmount: {
    whoseTurn: string;
    callAmount: number;
  } | null;
  hole?: Hole;
  board: Board;
  currentRoundFinished: boolean;
  isRejoinBlocked?: boolean;
  potAmount: number;
  bankrolls: Map<string, number>;
  autoFoldTimeoutSeconds?: number;
  audio?: Pick<GameAudioControls, 'play'>;
  fireBet: (amount: number) => void;
  fireFold: () => void;
}) {
  const {t} = useI18n();
  const {
    playerId,
    players,
    whoseTurnAndCallAmount,
    hole,
    board,
    currentRoundFinished,
    isRejoinBlocked,
    potAmount,
    bankrolls,
    fireBet,
    fireFold,
  } = props;

  if (isRejoinBlocked && !currentRoundFinished) {
    return (
      <div className="rejoin-notice rejoin-notice-blocked" role="status" aria-live="polite">
        <span>{t('originalBrowserOnly')}</span>
        <small>{t('openOriginalBrowser')}</small>
      </div>
    );
  }

  if (playerId && players?.includes(playerId) && whoseTurnAndCallAmount?.whoseTurn === playerId && !hole && !currentRoundFinished) {
    return (
      <div className="rejoin-notice rejoin-notice-restoring" role="status" aria-live="polite">
        <span>{t('restoringKeys')}</span>
        <small>{t('restoringCardKeys')}</small>
      </div>
    );
  }

  if (!playerId || !players || whoseTurnAndCallAmount?.whoseTurn !== playerId || !board || !hole || currentRoundFinished) {
    return <></>;
  }

  return <ActionButtons
    stateKey={`${playerId}:${whoseTurnAndCallAmount.whoseTurn}:${whoseTurnAndCallAmount.callAmount}:${board.length}:${potAmount}`}
    potAmount={potAmount}
    bankroll={bankrolls.get(playerId) ?? 0}
    fireBet={fireBet}
    fireFold={fireFold}
    callAmount={whoseTurnAndCallAmount?.callAmount ?? 0}
  />;
}
