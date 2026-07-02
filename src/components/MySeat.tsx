import React, {useMemo} from "react";
import MyActionButtons from "./MyActionButtons";
import MyBetAmount from "./MyBetAmount";
import MyPlayerAvatar from "./MyPlayerAvatar";
import MyBankroll from "./MyBankroll";
import MyHandCards from "./MyHandCards";
import {Board, Hole} from "../lib/rules";
import {GameAudioControls} from "../lib/useGameAudio";
import {WinningResult} from "../lib/texas-holdem/TexasHoldemGameRoom";
import {useHandRankLabel, useI18n} from "../lib/i18n";

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
  /** 本场累计输赢（一直显示），与按手结算的 scoreDelta 不同。 */
  netTotal?: number;
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
    netTotal,
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
  const {t} = useI18n();

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

  const myFolded = Boolean(playerId && actionsDone?.get(playerId) === 'fold');

  return (
    <div className={`my-seat${myTurnTimer ? ' my-seat-my-turn' : ''}${myFolded ? ' my-seat-folded' : ''}`}>
      <MyBetAmount playerId={playerId} actionsDone={actionsDone}/>
      <div className="my-action-dock" data-testid="my-action-dock">
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
      </div>
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
      {netTotal !== undefined && (
        <div
          className={`session-pnl ${netTotal > 0 ? 'positive' : netTotal < 0 ? 'negative' : 'flat'}`}
          title={t('netTotalTitle')}
          data-testid="my-session-pnl"
        >
          <span className="session-pnl-tag">{t('netTotalTag')}</span>
          <b>{netTotal > 0 ? '+' : netTotal < 0 ? '-' : ''}${Math.abs(netTotal)}</b>
        </div>
      )}
      <MyHandCards hole={hole}/>
    </div>
  );
}
