import React, {useEffect, useMemo, useState} from "react";
import Modal from "./Modal";
import PlayerAvatar from "./PlayerAvatar";
import {TexasHoldemTableEvent, WinningResult} from "../lib/texas-holdem/TexasHoldemGameRoom";
import {Board, calculateEffectiveCardOffsets, Hole} from "../lib/rules";
import CardImage from "./CardImage";
import {useHandRankLabel, useI18n} from "../lib/i18n";
import {TranscriptEntry, TranscriptSnapshot} from "../lib/fairness/transcript";
import {TexasHoldemRoundHistoryItem} from "../lib/texas-holdem/useTexasHoldem";

function formatChipDelta(score: number) {
  if (score === 0) {
    return '$0';
  }
  return `${score > 0 ? '+' : '-'}$${Math.abs(score)}`;
}

function winnersFromResult(result: WinningResult | undefined) {
  if (!result) {
    return [];
  }
  if (result.how === 'LastOneWins') {
    return [result.winner];
  }
  if (result.how === 'Voided') {
    return [];
  }
  return result.showdown[0]?.players ?? [];
}

function uniquePlayers(round: TexasHoldemRoundHistoryItem) {
  const seen = new Set<string>();
  const players = [
    ...round.players,
    ...Array.from(round.holesPerPlayer?.keys() ?? []),
    ...winnersFromResult(round.winningResult),
  ];
  return players.filter(player => {
    if (seen.has(player)) {
      return false;
    }
    seen.add(player);
    return true;
  });
}

function payloadFromTranscriptEntry(entry: TranscriptEntry<unknown>) {
  const wireEvent = entry.wireEvent as {payload?: unknown};
  return wireEvent && typeof wireEvent === 'object' && 'payload' in wireEvent
    ? wireEvent.payload
    : entry.wireEvent;
}

function transcriptEntriesForRound(transcript: TranscriptSnapshot<unknown> | null | undefined, round: number) {
  return (transcript?.entries ?? []).filter(entry => {
    const payload = payloadFromTranscriptEntry(entry) as {round?: unknown};
    return payload?.round === round;
  });
}

function downloadJson(data: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function shortHash(value: string | undefined) {
  if (!value) {
    return 'no-events';
  }
  return value.length > 22 ? `${value.slice(0, 12)}...${value.slice(-7)}` : value;
}

export default function ScoreBoardAndToggle(props: {
  scoreBoard: Map<string, number>;
  totalDebt: Map<string, number>;
  bankrolls: Map<string, number>;
  names: Map<string, string>;
  lastWinningResult: WinningResult | undefined;
  roundHistory?: TexasHoldemRoundHistoryItem[];
  transcript?: TranscriptSnapshot<TexasHoldemTableEvent> | null;
  mainPotWinners: Set<string> | null;
  holesPerPlayer: Map<string, Hole> | undefined;
  board: Board;
  playerId?: string;
  currentRoundFinished?: boolean;
  matchComplete?: boolean;
  onRestartMatch?: () => void | Promise<void>;
  canRestartMatch?: boolean;

  toggleDataTestId?: string;
  scoreBoardDataTestId?: string;
}) {
  const {t} = useI18n();
  const handRankLabel = useHandRankLabel();
  const [visible, setVisible] = useState(Boolean(props.matchComplete));

  useEffect(() => {
    if (props.matchComplete) {
      setVisible(true);
    }
  }, [props.matchComplete]);

  const handSettled = Boolean((props.currentRoundFinished || props.matchComplete) && props.lastWinningResult);
  const fallbackRoundHistory = useMemo<TexasHoldemRoundHistoryItem[]>(() => {
    const round = props.lastWinningResult?.round ?? 0;
    if (!round && !props.board.length && !props.holesPerPlayer?.size) {
      return [];
    }
    return [{
      round: round || 1,
      players: Array.from(new Set([
        ...Array.from(props.holesPerPlayer?.keys() ?? []),
        ...winnersFromResult(props.lastWinningResult),
      ])),
      board: props.board,
      holesPerPlayer: props.holesPerPlayer,
      winningResult: handSettled ? props.lastWinningResult : undefined,
    }];
  }, [handSettled, props.board, props.holesPerPlayer, props.lastWinningResult]);
  const roundHistory = useMemo(() => {
    const source = props.roundHistory?.length ? props.roundHistory : fallbackRoundHistory;
    return [...source].sort((a, b) => b.round - a.round);
  }, [fallbackRoundHistory, props.roundHistory]);
  const latestRound = roundHistory[0]?.round;
  const [selectedRound, setSelectedRound] = useState<number | undefined>(() => latestRound);

  useEffect(() => {
    if (!latestRound) {
      setSelectedRound(undefined);
      return;
    }
    setSelectedRound(prev => roundHistory.some(round => round.round === prev) ? prev : latestRound);
  }, [latestRound, roundHistory]);

  const winningResultDescription = useMemo(() => {
    if (!handSettled) {
      return t('liveReportCopy');
    }
    if (props.lastWinningResult?.how === 'Showdown') {
      const showdown = props.lastWinningResult.showdown[0];
      const rank = handRankLabel(showdown.handValue);
      return showdown.players.includes(props.playerId ?? '')
        ? t('youWonWith', {rank})
        : t('playerWonWith', {player: props.names.get(showdown.players[0]) ?? showdown.players[0], rank});
    }
    if (props.lastWinningResult?.how === 'LastOneWins') {
      const winner = props.lastWinningResult.winner;
      return winner === props.playerId
        ? t('youWonByFold')
        : t('youLostByFold', {player: props.names.get(winner) ?? winner});
    }
    if (props.lastWinningResult?.how === 'Voided') {
      return t('handVoided');
    }
    return t('settlementPending');
  }, [handRankLabel, handSettled, props.lastWinningResult, props.names, props.playerId, t]);

  const winners = useMemo(() => handSettled ? Array.from(props.mainPotWinners ?? []) : [], [handSettled, props.mainPotWinners]);
  const selectedRoundReview = useMemo(
    () => roundHistory.find(round => round.round === selectedRound) ?? roundHistory[0],
    [roundHistory, selectedRound],
  );
  const selectedRoundWinners = useMemo(
    () => winnersFromResult(selectedRoundReview?.winningResult),
    [selectedRoundReview],
  );
  const selectedRoundPlayers = useMemo(
    () => selectedRoundReview ? uniquePlayers(selectedRoundReview) : [],
    [selectedRoundReview],
  );
  const selectedRoundEvidenceEntries = useMemo(
    () => selectedRoundReview ? transcriptEntriesForRound(props.transcript, selectedRoundReview.round) : [],
    [props.transcript, selectedRoundReview],
  );
  const playerResults = useMemo(() => (
    Array.from(props.scoreBoard.entries()).sort(([, s1], [, s2]) => s2 - s1)
  ), [props.scoreBoard]);
  const reportKicker = props.matchComplete || handSettled ? t('finalReportKicker') : t('liveReportKicker');
  const reportTitle = props.matchComplete
    ? t('finalReportTitle')
    : handSettled
      ? t('handReportTitle')
      : t('liveReportTitle');
  const emptyWinnerCopy = handSettled ? t('settlementPending') : t('handInProgress');
  const downloadSelectedRoundEvidence = () => {
    if (!selectedRoundReview || !props.transcript) {
      return;
    }
    downloadJson({
      version: 'fairpoker.round-evidence.v1',
      round: selectedRoundReview.round,
      transcriptFinalHash: props.transcript.finalHash,
      entries: selectedRoundEvidenceEntries,
      tableView: {
        players: selectedRoundReview.players,
        board: selectedRoundReview.board,
        holesPerPlayer: Array.from(selectedRoundReview.holesPerPlayer?.entries() ?? []),
        winningResult: selectedRoundReview.winningResult,
      },
    }, `fairpoker-round-${selectedRoundReview.round}-evidence.json`);
  };
  const downloadAllEvidence = () => {
    if (!props.transcript) {
      return;
    }
    downloadJson(props.transcript, `fairpoker-match-evidence-${props.transcript.finalHash.replace(/[^a-z0-9]/gi, '-').slice(0, 28)}.json`);
  };

  return (
    <>
      <span
        className="score-board-toggle"
        role="button"
        tabIndex={0}
        aria-label={reportTitle}
        onClick={() => setVisible(true)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setVisible(true);
          }
        }}
        title={reportTitle}
        data-testid={props.toggleDataTestId ?? 'score-board-toggle'}
      >
        <img src={`${process.env.PUBLIC_URL}/podium.svg`} alt={reportTitle}/>
      </span>
      <Modal visible={visible} onClick={() => setVisible(false)} data-testid={props.scoreBoardDataTestId}>
        <span className="close" onClick={() => setVisible(false)} data-testid="modal-close">&times;</span>
        <div className="score-board">
          <header className="score-board-hero">
            <div className="score-board-kicker">{reportKicker}</div>
            <h4>{reportTitle}</h4>
            <div className="score-board-winners" aria-label={t('winners')}>
              {
                winners.length > 0
                  ? winners.map(winner => (
                    <div className="score-board-winner" key={winner}>
                      <PlayerAvatar playerId={winner} />
                      <span>{props.names.get(winner) ?? winner}</span>
                    </div>
                  ))
                  : <span className="score-board-muted">{emptyWinnerCopy}</span>
              }
            </div>
            {!props.matchComplete && handSettled && (
              <div className="result-description">{winningResultDescription}</div>
            )}
          </header>

          {roundHistory.length > 0 && (
            <section className="score-board-history" aria-label={t('handHistory')}>
              <aside className="score-board-round-list" aria-label={t('handHistory')}>
                {roundHistory.map(round => {
                  const roundWinners = winnersFromResult(round.winningResult);
                  const selected = selectedRoundReview?.round === round.round;
                  return (
                    <button
                      type="button"
                      key={round.round}
                      className={selected ? 'score-board-round-tab selected' : 'score-board-round-tab'}
                      onClick={() => setSelectedRound(round.round)}
                      data-testid={`score-board-round-${round.round}`}
                    >
                      <span>{t('handNumber', {round: round.round})}</span>
                      <strong>{
                        round.winningResult
                          ? roundWinners.map(player => props.names.get(player) ?? player).join(' / ')
                          : t('handInProgress')
                      }</strong>
                    </button>
                  );
                })}
              </aside>

              {selectedRoundReview && (
                <div className="score-board-round-detail" data-testid="score-board-round-detail">
                  <div className="score-board-round-toolbar">
                    <div>
                      <span>{t('reviewHand')}</span>
                      <strong>{t('handNumber', {round: selectedRoundReview.round})}</strong>
                    </div>
                    <div className="score-board-evidence-actions">
                      <button
                        type="button"
                        className="score-board-evidence-button"
                        onClick={downloadSelectedRoundEvidence}
                        disabled={!props.transcript}
                        data-testid="download-round-evidence"
                      >{t('downloadHandEvidence')}</button>
                      <button
                        type="button"
                        className="score-board-evidence-button secondary"
                        onClick={downloadAllEvidence}
                        disabled={!props.transcript}
                        data-testid="download-match-evidence"
                      >{t('downloadMatchEvidence')}</button>
                    </div>
                  </div>

                  <div className="score-board-evidence-strip">
                    <span>{t('evidenceEvents', {count: selectedRoundEvidenceEntries.length})}</span>
                    <strong>{shortHash(props.transcript?.finalHash)}</strong>
                  </div>

                  <div className="score-board-board-review">
                    <div className="score-board-card-label">{t('boardCards')}</div>
                    <div className="community-cards">
                      {[0, 1, 2, 3, 4].map(i => (
                        <CardImage
                          key={i}
                          card={selectedRoundReview.board[i]}
                          data-testid={`score-board-board-card-${i}`}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="score-board-player-review-grid">
                    {selectedRoundPlayers.map(playerInShowdown => {
                      const hole = selectedRoundReview.holesPerPlayer?.get(playerInShowdown);
                      const showdownGroup = selectedRoundReview.winningResult?.how === 'Showdown'
                        ? selectedRoundReview.winningResult.showdown.find(group => group.players.includes(playerInShowdown))
                        : undefined;
                      const boardAndHole = hole ? [...selectedRoundReview.board, ...hole] : [...selectedRoundReview.board];
                      const effectiveOffsets = hole && showdownGroup
                        ? calculateEffectiveCardOffsets(boardAndHole, showdownGroup.strength)
                        : undefined;
                      const isWinner = selectedRoundWinners.includes(playerInShowdown);
                      const rankLabel = showdownGroup
                        ? handRankLabel(showdownGroup.handValue)
                        : isWinner && selectedRoundReview.winningResult?.how === 'LastOneWins'
                          ? t('handResultLastOne')
                          : t('player');
                      return (
                        <article className={isWinner ? 'score-board-player-review winner' : 'score-board-player-review'} key={playerInShowdown}>
                          <div className="score-board-player-line">
                            <PlayerAvatar playerId={playerInShowdown}/>
                            <div>
                              <strong>{props.names.get(playerInShowdown) ?? playerInShowdown}</strong>
                              <span>{isWinner ? t('winner') : rankLabel}</span>
                            </div>
                            <b>{rankLabel}</b>
                          </div>
                          <div className="score-board-card-label">{t('holeCards')}</div>
                          <div className="hand-cards">
                            <CardImage {... effectiveOffsets && !effectiveOffsets.includes(5) && {className: 'ineffective'}} card={hole?.[0]} data-testid="score-board-hand-card-0"/>
                            <CardImage {... effectiveOffsets && !effectiveOffsets.includes(6) && {className: 'ineffective'}} card={hole?.[1]} data-testid="score-board-hand-card-1"/>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </div>
              )}
            </section>
          )}

          {props.matchComplete && (
            <footer className="score-board-match-complete">
              <div>
                <strong>{t('finalReportTitle')}</strong>
                <span>{t(props.canRestartMatch ? 'finalReportRegistrationCopy' : 'finalReportGuestCopy')}</span>
              </div>
              {props.canRestartMatch && props.onRestartMatch && (
                <button
                  type="button"
                  className="action-button start-button"
                  onClick={() => {
                    setVisible(false);
                    void props.onRestartMatch?.();
                  }}
                  data-testid="score-board-new-table-button"
                >{t('restartMatch')}</button>
              )}
            </footer>
          )}

          <section className="settlement-grid" aria-label={t('playerResults')}>
            {
              playerResults.map(([player, score]) => {
                const isWinner = winners.includes(player);
                const bankroll = props.bankrolls.get(player) ?? 0;
                const deltaClass = score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
                return (
                  <article className={`settlement-card ${isWinner ? 'winner' : ''}`} key={player}>
                    <div className="settlement-player">
                      <PlayerAvatar playerId={player}/>
                      <div>
                        <strong>{props.names.get(player) ?? player}</strong>
                        <span>{
                          !handSettled
                            ? (player === props.playerId ? t('liveYouStatus') : t('player'))
                            : player === props.playerId
                            ? (isWinner ? t('youWinner') : t('youLostHand'))
                            : (isWinner ? t('winner') : t('player'))
                        }</span>
                      </div>
                    </div>
                    <div className={`settlement-delta ${deltaClass}`}>{formatChipDelta(score)}</div>
                    <div className="settlement-meta">
                      <span>{t('finalChips')}</span>
                      <strong>${Math.abs(bankroll)}</strong>
                    </div>
                  </article>
                )
              })
            }
          </section>
        </div>
      </Modal>
    </>
  );
}
