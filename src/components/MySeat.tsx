import React, {useMemo} from "react";
import MyActionButtons from "./MyActionButtons";
import MyBetAmount from "./MyBetAmount";
import MyPlayerAvatar from "./MyPlayerAvatar";
import MyBankroll from "./MyBankroll";
import MyHandCards from "./MyHandCards";
import {Board, Hole} from "../lib/rules";
import {GameAudioControls} from "../lib/useGameAudio";
import {WinningResult} from "../lib/texas-holdem/TexasHoldemGameRoom";
import {useHandRankLabel} from "../lib/i18n";

export default function MySeat(props: {
  playerId: string | undefined;
  players: string[] | undefined;
  board: Board;
  hole: Hole | undefined;
  potAmount: number;
  bankrolls: Map<string, number>;
  names: Map<string, string>;
  setMyName: (name: string) => void;
  mainPotWinners: Set<string> | null;
  lastWinningResult?: WinningResult;
  scoreDelta?: number;
  currentRoundFinished: boolean;
  isRejoinBlocked?: boolean;
  connectionStatus?: 'good' | 'warn' | 'offline';
  actionsDone: Map<string, string | number> | null;
  autoFoldTimeoutSeconds?: number;
  audio?: Pick<GameAudioControls, 'play'>;
  whoseTurnAndCallAmount: {
    whoseTurn: string;
    callAmount: number;
  } | null;
  actions: {
    fireBet: (amount: number) => Promise<void>;
    fireFold: () => Promise<void>;
    sitOut: () => Promise<void>;
    returnToTable: () => Promise<void>;
  }
}) {
  const {
    playerId,
    players,
    lastWinningResult,
    scoreDelta,
    currentRoundFinished,
    isRejoinBlocked,
    connectionStatus,
    actionsDone,
    autoFoldTimeoutSeconds,
    audio,
    board,
    hole,
    potAmount,
    bankrolls,
    names,
    setMyName,
    whoseTurnAndCallAmount,
    actions,
  } = props;
  const handRankLabel = useHandRankLabel();

  const myTurnTimer = playerId && whoseTurnAndCallAmount?.whoseTurn === playerId && !currentRoundFinished
    ? {
      active: true,
      timeoutSeconds: autoFoldTimeoutSeconds,
      timerKey: `${playerId}:${whoseTurnAndCallAmount.callAmount}:${board.length}:${potAmount}`,
      audio,
    }
    : undefined;
  const myHandRank = useMemo(() => {
    if (!playerId || !currentRoundFinished || lastWinningResult?.how !== 'Showdown') {
      return null;
    }
    const group = lastWinningResult.showdown.find(showdown => showdown.players.includes(playerId));
    return group ? handRankLabel(group.handValue) : null;
  }, [currentRoundFinished, handRankLabel, lastWinningResult, playerId]);

  return (
    <div className="my-seat">
      <MyBetAmount playerId={playerId} actionsDone={actionsDone}/>
      <MyActionButtons
        playerId={playerId}
        players={players}
        whoseTurnAndCallAmount={whoseTurnAndCallAmount}
        board={board}
        hole={hole}
        currentRoundFinished={currentRoundFinished}
        isRejoinBlocked={isRejoinBlocked}
        potAmount={potAmount}
        bankrolls={bankrolls}
        autoFoldTimeoutSeconds={autoFoldTimeoutSeconds}
        audio={audio}
        fireBet={actions.fireBet}
        fireFold={actions.fireFold}
      />
      <MyPlayerAvatar
        playerId={playerId}
        names={names}
        setMyName={setMyName}
        connectionStatus={connectionStatus}
        turnTimer={myTurnTimer}
      />
      {myHandRank && (
        <div className="hand-rank-badge" data-testid="my-hand-rank-badge">{myHandRank}</div>
      )}
      {currentRoundFinished && scoreDelta !== undefined && scoreDelta !== 0 && (
        <div
          className={scoreDelta > 0 ? 'chip-delta positive' : 'chip-delta negative'}
          data-testid="my-chip-delta"
        >{scoreDelta > 0 ? '+' : '-'}${Math.abs(scoreDelta)}</div>
      )}
      <MyBankroll playerId={playerId} players={players} bankrolls={bankrolls}/>
      <MyHandCards hole={hole}/>
    </div>
  );
}
