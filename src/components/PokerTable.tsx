import React, {useEffect, useRef, useState} from "react";
import {Board} from "../lib/rules";
import CommunityCardsOnTable from "./CommunityCardsOnTable";
import {TexasHoldemRoundSettings, WinningResult} from "../lib/texas-holdem/TexasHoldemGameRoom";
import Staging from "./Staging";
import {WorkerRoomState} from "../lib/CloudflareRelayTransport";
import EncryptedShuffleOverlay from "./EncryptedShuffleOverlay";
import FairnessVerificationOverlay from "./FairnessVerificationOverlay";
import {workerRoomTablePlayers} from "../lib/useWorkerRoomState";

export default function PokerTable(props: {
  members: string[];
  playerId: string | undefined;
  players: string[] | undefined;
  round: number | undefined;
  board: Board;
  potAmount: number;
  currentRoundFinished: boolean;
  lastWinningResult: WinningResult | undefined;
  startGame: (settings?: Partial<TexasHoldemRoundSettings>) => Promise<void>;
  /** Client's own "can start" (>=2 seated locally); host-only fallback when the worker view is stale. */
  localPlayable?: boolean;
  onRoundSettingsChange?: (settings: TexasHoldemRoundSettings) => void | Promise<void>;
  roundSettings?: TexasHoldemRoundSettings;
  names?: Map<string, string>;
  seriesProgress?: {
    current: number;
    total: number;
    complete: boolean;
  };
  nextHandAutoStartDelaySeconds?: number;
  shuffleOverlayStartedAt?: number | null;
  shuffleParticipants?: string[];
  roomState?: WorkerRoomState | null;
  /** The host has explicitly ended the series and opened registration for a new one. */
  registrationOpen?: boolean;
  suppressStaging?: boolean;
  nextHandRecoveryRequested?: boolean;
  returnToTableRequested?: boolean;
  onReturnToTable?: () => void | Promise<void>;
  onNextHandCountdownComplete?: (options?: {manual?: boolean}) => void;
}) {
  const {
    members,
    playerId,
    players,
    round,
    board,
    potAmount,
    currentRoundFinished,
    lastWinningResult,
    startGame,
    onRoundSettingsChange,
    roundSettings,
    names,
    seriesProgress,
    nextHandAutoStartDelaySeconds,
    shuffleOverlayStartedAt,
    shuffleParticipants,
    roomState,
    suppressStaging,
    nextHandRecoveryRequested,
    returnToTableRequested,
    onReturnToTable,
    onNextHandCountdownComplete,
  } = props;
  const showingSettlementResult = Boolean(
    currentRoundFinished
    && (
      lastWinningResult?.how === 'Showdown'
      || lastWinningResult?.how === 'LastOneWins'
      || lastWinningResult?.how === 'Voided'
    )
  );
  const showingStaging = Boolean(currentRoundFinished && playerId && !suppressStaging);
  const useStagingLayout = showingStaging && !showingSettlementResult;
  const showingShuffleOverlay = Boolean(shuffleOverlayStartedAt);
  const tablePlayers = roomState
    ? workerRoomTablePlayers(roomState)
    : players ?? members;
  const overlayParticipants = shuffleParticipants?.length
    ? shuffleParticipants
    : tablePlayers;

  const [fairnessVerify, setFairnessVerify] = useState<{round: number; startedAt: number} | null>(null);
  const fairnessShownRoundRef = useRef<number | null>(null);
  useEffect(() => {
    if (!currentRoundFinished || typeof round !== 'number') {
      setFairnessVerify(null);
      return;
    }
    if (fairnessShownRoundRef.current === round) {
      return;
    }
    fairnessShownRoundRef.current = round;
    // Let the winner / showdown register first, then play the fairness check.
    const timer = setTimeout(() => setFairnessVerify({round, startedAt: Date.now()}), 1800);
    return () => clearTimeout(timer);
  }, [currentRoundFinished, round]);
  const shouldShowCommunityCards = Boolean(
    players
    && board
    && !showingShuffleOverlay
    && (!useStagingLayout || showingSettlementResult || seriesProgress?.complete)
  );
  return (
    <div className={`table${useStagingLayout ? ' table-staging' : ''}`} data-testid="table">
      {!showingStaging && showingShuffleOverlay && (
        <EncryptedShuffleOverlay
          visible
          startedAtMs={shuffleOverlayStartedAt ?? 0}
          participants={overlayParticipants}
          names={names}
          playerId={playerId}
        />
      )}
      {fairnessVerify && (
        <FairnessVerificationOverlay
          key={fairnessVerify.startedAt}
          visible
          round={fairnessVerify.round}
          participants={overlayParticipants}
          names={names}
          playerId={playerId}
          onDismiss={() => setFairnessVerify(null)}
        />
      )}
      {
        shouldShowCommunityCards &&
          <CommunityCardsOnTable board={board} potAmount={potAmount} currentRoundFinished={currentRoundFinished}
                                 lastWinningResult={lastWinningResult}/>
      }
      {
        showingStaging && playerId &&
          <Staging
              round={round}
              playerId={playerId}
              members={members}
              players={players}
              startGame={startGame}
              onRoundSettingsChange={onRoundSettingsChange}
              roundSettings={roundSettings}
              names={names ?? new Map()}
              seriesProgress={seriesProgress}
              localPlayable={props.localPlayable}
              nextHandAutoStartDelaySeconds={nextHandAutoStartDelaySeconds}
              shuffleOverlayStartedAt={shuffleOverlayStartedAt}
              shuffleParticipants={shuffleParticipants}
              roomState={roomState}
              registrationOpen={props.registrationOpen}
              nextHandRecoveryRequested={nextHandRecoveryRequested}
              returnToTableRequested={returnToTableRequested}
              onReturnToTable={onReturnToTable}
              onNextHandCountdownComplete={onNextHandCountdownComplete}
          />
      }
    </div>
  );
}
