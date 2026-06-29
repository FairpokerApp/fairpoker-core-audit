import PlayerAvatar from "./PlayerAvatar";
import React, {useState} from "react";
import HandCards from "./HandCards";
import BetAmount from "./BetAmount";
import {Board, Hole} from "../lib/rules";
import Modal from "./Modal";
import {useRoomRisk} from "../lib/peerRisk";
import {PeerRiskDetails} from "./CollusionRiskPanel";
import {useHandRankLabel, useI18n} from "../lib/i18n";
import {WorkerRoomState} from "../lib/CloudflareRelayTransport";
import {workerConnectionStatus} from "../lib/useWorkerRoomState";
import {WinningResult} from "../lib/texas-holdem/TexasHoldemGameRoom";
import {workerRoomSeatedPlayers} from "../lib/useWorkerRoomState";

export default function Opponents(props: {
  members: string[];
  playerId: string | undefined;
  players: string[] | undefined;
  names: Map<string, string>;
  bankrolls: Map<string, number>;
  board: Board;
  whoseTurn: string | undefined;
  holesPerPlayer: Map<string, Hole> | undefined;
  mainPotWinners: Set<string> | null;
  lastWinningResult?: WinningResult;
  scoreBoard?: Map<string, number>;
  currentRoundFinished?: boolean;
  actionsDone: Map<string, string | number> | null;
  autoFoldTimeoutSeconds?: number;
  roomState?: WorkerRoomState | null;
}) {
  const {
    members,
    playerId,
    players,
    names,
    bankrolls,
    board,
    whoseTurn,
    holesPerPlayer,
    lastWinningResult,
    scoreBoard,
    currentRoundFinished,
    actionsDone,
    autoFoldTimeoutSeconds,
    roomState,
  } = props;
  const {t} = useI18n();
  const handRankLabel = useHandRankLabel();
  const [selectedOpponent, setSelectedOpponent] = useState<string | undefined>();
  const {profiles, roomRisk} = useRoomRisk(playerId, members);
  const closeOpponentDetails = () => setSelectedOpponent(undefined);
  const tableMembers = roomState
    ? workerRoomSeatedPlayers(roomState)
    : players ?? members;
  const connectionStatusFor = (opponent: string): 'good' | 'warn' | 'offline' => {
    const workerPlayer = roomState?.players.find(player => player.peerId === opponent);
    const workerStatus = workerConnectionStatus(workerPlayer);
    return workerStatus ?? 'warn';
  };
  const handRankFor = (player: string) => {
    if (!currentRoundFinished || lastWinningResult?.how !== 'Showdown') {
      return null;
    }
    const group = lastWinningResult.showdown.find(showdown => showdown.players.includes(player));
    return group ? handRankLabel(group.handValue) : null;
  };
  const scoreDeltaFor = (player: string) => currentRoundFinished ? scoreBoard?.get(player) : undefined;
  const renderOpponentAvatar = (opponent: string) => (
    <button
      type="button"
      className="opponent-profile-button"
      onClick={() => setSelectedOpponent(opponent)}
      title={t('opponentProfileDetails')}
      aria-label={t('opponentProfileDetails')}
      data-testid="opponent-profile-button"
    >
      <PlayerAvatar
        playerId={opponent}
        playerName={names.get(opponent) ?? `${opponent.slice(0, 6)}...${opponent.slice(-4)}`}
        highlight={whoseTurn === opponent}
        connectionStatus={connectionStatusFor(opponent)}
        turnTimer={whoseTurn === opponent ? {
          active: true,
          timeoutSeconds: autoFoldTimeoutSeconds,
          timerKey: `${opponent}:${board.length}:${actionsDone?.get(opponent) ?? 'pending'}`,
        } : undefined}
      />
    </button>
  );

  return (
    <>
      <Modal
        visible={Boolean(selectedOpponent)}
        onClick={closeOpponentDetails}
        data-testid="opponent-risk-modal"
      >
        {selectedOpponent && (
          <div className="opponent-risk-modal">
            <header className="opponent-risk-header">
              <div>
                <strong>{t('opponentProfile')}</strong>
                <small>{names.get(selectedOpponent) ?? `${selectedOpponent.slice(0, 6)}...${selectedOpponent.slice(-4)}`}</small>
              </div>
              <button
                type="button"
                className="security-icon-button"
                onClick={closeOpponentDetails}
                aria-label={t('closeOpponentProfile')}
              >
                ×
              </button>
            </header>
            <PeerRiskDetails
              peerId={selectedOpponent}
              myPlayerId={playerId}
              members={members}
              profiles={profiles}
              roomRisk={roomRisk}
            />
          </div>
        )}
      </Modal>
      {
        (!players && playerId) && (
          <div className="opponents" data-testid="opponents">
            {
              tableMembers.filter(member => member !== playerId).map((member, i) => (
                <div key={member} className="opponent" data-testid={`opponent-${i}`}>
                  {renderOpponentAvatar(member)}
                </div>
              ))
            }
          </div>
        )
      }
      {
        players && (
          <div className="opponents" data-testid="opponents">
            {((): React.ReactElement[] => {
              const myOffset = players.findIndex(p => p === playerId);
              const playersStartingAfterMe = myOffset < 0
                ? [...players]
                : [...players.slice(myOffset + 1), ...players.slice(0, myOffset)];
              return playersStartingAfterMe
                .filter(p => p !== playerId)
                .map((opponent, i) => (
                  <div
                    key={opponent}
                    className="opponent"
                    data-testid={`opponent-${i}`}
                  >
                    {renderOpponentAvatar(opponent)}
                    {handRankFor(opponent) && (
                      <div className="hand-rank-badge" data-testid="hand-rank-badge">{handRankFor(opponent)}</div>
                    )}
                    {scoreDeltaFor(opponent) !== undefined && scoreDeltaFor(opponent) !== 0 && (
                      <div
                        className={scoreDeltaFor(opponent)! > 0 ? 'chip-delta positive' : 'chip-delta negative'}
                        data-testid="chip-delta"
                      >{scoreDeltaFor(opponent)! > 0 ? '+' : '-'}${Math.abs(scoreDeltaFor(opponent)!)}</div>
                    )}
                    {players && <div className="bankroll">${bankrolls.get(opponent) ?? 0}</div>}
                    {board && <HandCards hole={holesPerPlayer?.get(opponent)}/>}
                    {
                      actionsDone && <BetAmount playerId={opponent} actionsDone={actionsDone}/>
                    }
                  </div>
                ));
            })()}
          </div>
        )
      }
    </>
  );
}
