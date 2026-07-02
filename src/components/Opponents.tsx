import PlayerAvatar from "./PlayerAvatar";
import React, {useCallback, useEffect, useRef, useState} from "react";
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
import {SEAT_COUNT} from "../lib/texas-holdem/texasHoldemReducer";

// 9-max oval seating. Hero is always bottom-centre; opponents fan out clockwise
// from the hero's lower-left, over the top, to the hero's lower-right — the bottom
// arc (toward the hero) is left open. Positions are percentages of the felt stage,
// so the same numbers render as a TALL oval on a phone and a WIDE oval on desktop.
const SEAT_ARC_START_DEG = 236; // lower-left, just left of the hero
const SEAT_ARC_SWEEP_DEG = 248; // wraps over the top to lower-right (open bottom)
const SEAT_RADIUS_X = 49;
const SEAT_RADIUS_Y = 46;
const SEAT_CENTER_Y = 53;
// Edge-seat clamp differs by viewport: a phone is a TALL narrow oval, so seats are
// pulled in (13–87) to keep each seat + its revealed cards on-screen; a desktop is a
// WIDE oval, so seats spread to the rim (4–96) instead of bunching toward the middle.
const SEAT_X_MIN_NARROW = 10, SEAT_X_MAX_NARROW = 90;
const SEAT_X_MIN_WIDE = 4, SEAT_X_MAX_WIDE = 96;

function useIsNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 760);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth <= 760);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return narrow;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// The live bet / showdown result for each seat sits on an inner "bet ring" between
// the seats and the centred board — on the felt, in front of the player, clear of
// the seat's own name/stack and of every neighbour.
// Bet/result chips ride a ring at this fraction of the seat radius. A near-empty table
// keeps a LARGE board, so chips ride closer to the seats (higher factor) to clear the
// board's wide corners; a crowded table has a SMALL board, so chips ride further in
// (lower factor) to clear the seats' own avatars.
const BET_RING_FACTOR_SPARSE = 0.74;
const BET_RING_FACTOR_CROWDED = 0.65;

// At/above this many opponents the table switches to its "crowded" geometry: a SMALL
// board + chips riding further in. We flip at 4 (a 5-handed table) because the wide
// "sparse" board only stays clear of the side seats' bet chips up to 3 opponents.
const CROWDED_MIN_OPPONENTS = 4;

// A real 9-max table: the hero owns the bottom seat; these are the eight fixed seats
// ringing the rest of the table. Opponents fill them from the top outward (so a few
// players still read as evenly seated), and unfilled seats show an open-seat marker.
const OPPONENT_SEAT_COUNT = 8;
const SEAT_FILL_ORDER = [3, 4, 2, 5, 1, 6, 0, 7];

// The (x, y) felt-percent centre of opponent ring slot `index` (0..7).
function ovalSeatCoord(index: number, narrow: boolean): { x: number; y: number } {
  const step = SEAT_ARC_SWEEP_DEG / (OPPONENT_SEAT_COUNT + 1);
  const deg = (SEAT_ARC_START_DEG + (index + 1) * step) % 360;
  const rad = (deg * Math.PI) / 180;
  const xMin = narrow ? SEAT_X_MIN_NARROW : SEAT_X_MIN_WIDE;
  const xMax = narrow ? SEAT_X_MAX_NARROW : SEAT_X_MAX_WIDE;
  const x = clamp(50 + SEAT_RADIUS_X * Math.sin(rad), xMin, xMax);
  const y = SEAT_CENTER_Y - SEAT_RADIUS_Y * Math.cos(rad);
  return { x, y };
}

function ovalSeatStyle(index: number, total: number, narrow: boolean, crowded: boolean): React.CSSProperties {
  const step = SEAT_ARC_SWEEP_DEG / (total + 1);
  const deg = (SEAT_ARC_START_DEG + (index + 1) * step) % 360;
  const rad = (deg * Math.PI) / 180;
  const xMin = narrow ? SEAT_X_MIN_NARROW : SEAT_X_MIN_WIDE;
  const xMax = narrow ? SEAT_X_MAX_NARROW : SEAT_X_MAX_WIDE;
  const BET_RING_FACTOR = crowded ? BET_RING_FACTOR_CROWDED : BET_RING_FACTOR_SPARSE;
  const x = clamp(50 + SEAT_RADIUS_X * Math.sin(rad), xMin, xMax);
  const y = SEAT_CENTER_Y - SEAT_RADIUS_Y * Math.cos(rad);
  // The bet/result chip sits on a ring at BET_RING_FACTOR of the seat radius (the same
  // seat angle), i.e. just inside the rail in front of the player — clear of the seat's
  // own avatar and of the centred board. Computed from the seat's true (unclamped) angle
  // and rendered relative to the on-screen (clamped) seat. Delta is in felt-percent,
  // applied via container-query units (1cqw/1cqh = 1% of the felt).
  const ringX = 50 + SEAT_RADIUS_X * BET_RING_FACTOR * Math.sin(rad);
  const ringY = SEAT_CENTER_Y - SEAT_RADIUS_Y * BET_RING_FACTOR * Math.cos(rad);
  return {
    '--seat-x': `${x.toFixed(2)}%`,
    '--seat-y': `${y.toFixed(2)}%`,
    '--bet-cx': (ringX - x).toFixed(2),
    '--bet-cy': (ringY - y).toFixed(2),
  } as React.CSSProperties;
}

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
  /** 本场累计输赢（funds − boughtIn），一直显示在每个座位上，与上面按手结算的 scoreBoard 不同。 */
  totalScoreBoard?: Map<string, number>;
  currentRoundFinished?: boolean;
  actionsDone: Map<string, string | number> | null;
  autoFoldTimeoutSeconds?: number;
  roomState?: WorkerRoomState | null;
  seatByPeer?: Map<string, number>;
  mySeat?: number;
  onTakeSeat?: (seat: number) => void;
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
    totalScoreBoard,
    seatByPeer,
    mySeat,
    onTakeSeat,
    currentRoundFinished,
    actionsDone,
    // Reserved for the opponent auto-fold countdown UI (not wired up yet). Kept destructured
    // so it's ready to use; silence the unused-var lint so the CI build doesn't fail.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    autoFoldTimeoutSeconds,
    roomState,
  } = props;
  const {t} = useI18n();
  const handRankLabel = useHandRankLabel();
  const [selectedOpponent, setSelectedOpponent] = useState<string | undefined>();
  const isNarrow = useIsNarrow();

  // Bet animation, like a real table: a player's chips sit IN FRONT of them while the
  // street is live (the bet display), then — when the street is dealt on, or the hand
  // ends — those chips are swept INTO the pot and clear from in front. The `.bet-amount`
  // display does the "place in front"; this sweeps it to the pot at collection time.
  const POT_X = 50, POT_Y = 53; // pot centre, in felt-percent
  const oppCount = players ? players.filter(p => p !== playerId).length : 0;
  const isCrowdedTable = oppCount >= CROWDED_MIN_OPPONENTS;
  // The felt-% spot where a player's bet chips sit (in front of them, toward the pot).
  const betCoordForPlayer = useCallback((pid: string): { x: number; y: number } | null => {
    if (pid === playerId) return { x: 50, y: 86 }; // the hero's bet, just below the felt centre
    if (seatByPeer && mySeat != null) {
      const abs = seatByPeer.get(pid);
      if (abs != null) {
        const rel = (abs - mySeat + SEAT_COUNT) % SEAT_COUNT;
        if (rel >= 1 && rel <= OPPONENT_SEAT_COUNT) {
          const slot = rel - 1;
          const step = SEAT_ARC_SWEEP_DEG / (OPPONENT_SEAT_COUNT + 1);
          const deg = (SEAT_ARC_START_DEG + (slot + 1) * step) % 360;
          const rad = (deg * Math.PI) / 180;
          const factor = isCrowdedTable ? BET_RING_FACTOR_CROWDED : BET_RING_FACTOR_SPARSE;
          return { x: 50 + SEAT_RADIUS_X * factor * Math.sin(rad), y: SEAT_CENTER_Y - SEAT_RADIUS_Y * factor * Math.cos(rad) };
        }
      }
    }
    return null;
  }, [playerId, seatByPeer, mySeat, isCrowdedTable]);
  const prevBetsRef = useRef<Map<string, number>>(new Map());
  const prevBoardLenRef = useRef<number>(board.length);
  const prevFinishedRef = useRef<boolean>(Boolean(currentRoundFinished));
  const didInitBetsRef = useRef(false);
  const [flyingChips, setFlyingChips] = useState<Array<{ id: string; x: number; y: number; dx: number; dy: number }>>([]);
  useEffect(() => {
    const curBets = new Map<string, number>();
    if (actionsDone) {
      actionsDone.forEach((val, pid) => { if (typeof val === 'number' && val > 0) curBets.set(pid, val); });
    }
    const streetAdvanced = board.length > prevBoardLenRef.current;
    const handJustFinished = Boolean(currentRoundFinished) && !prevFinishedRef.current;
    if (didInitBetsRef.current && (streetAdvanced || handJustFinished) && prevBetsRef.current.size > 0) {
      // Sweep the bets that were sitting in front (the latest street's, kept below) to the pot.
      const added: Array<{ id: string; x: number; y: number; dx: number; dy: number }> = [];
      const now = Date.now();
      prevBetsRef.current.forEach((_val, pid) => {
        const c = betCoordForPlayer(pid);
        if (c) added.push({ id: `${pid}-${now}`, x: c.x, y: c.y, dx: POT_X - c.x, dy: POT_Y - c.y });
      });
      prevBetsRef.current = new Map(); // collected — nothing left in front
      if (added.length) {
        setFlyingChips(cur => [...cur, ...added]);
        const ids = new Set(added.map(a => a.id));
        window.setTimeout(() => setFlyingChips(cur => cur.filter(c => !ids.has(c.id))), 560);
      }
    } else if (curBets.size > 0) {
      // Remember the latest non-empty street bets so a collection can sweep exactly them.
      prevBetsRef.current = curBets;
    }
    didInitBetsRef.current = true;
    prevBoardLenRef.current = board.length;
    prevFinishedRef.current = Boolean(currentRoundFinished);
  }, [actionsDone, board.length, currentRoundFinished, betCoordForPlayer]);
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
  // 本场累计输赢的常驻小标签（一直显示，$0 也显示，用低调的中性色）。
  const renderSessionPnl = (player: string) => {
    if (!totalScoreBoard) {
      return null;
    }
    const net = totalScoreBoard.get(player) ?? 0;
    const tone = net > 0 ? 'positive' : net < 0 ? 'negative' : 'flat';
    return (
      <div className={`session-pnl ${tone}`} title={t('netTotalTitle')} data-testid="session-pnl">
        <span className="session-pnl-tag">{t('netTotalTag')}</span>
        <b>{net > 0 ? '+' : net < 0 ? '-' : ''}${Math.abs(net)}</b>
      </div>
    );
  };
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
          <div
            className={`opponents opponents-oval${currentRoundFinished ? ' opponents-oval-showdown' : ''}${
              players.filter(p => p !== playerId).length >= CROWDED_MIN_OPPONENTS ? ' opponents-oval-crowded' : ''}`}
            data-testid="opponents"
          >
            {((): React.ReactElement[] => {
              const myOffset = players.findIndex(p => p === playerId);
              const playersStartingAfterMe = myOffset < 0
                ? [...players]
                : [...players.slice(myOffset + 1), ...players.slice(0, myOffset)];
              const opponentsOrdered = playersStartingAfterMe.filter(p => p !== playerId);
              const crowded = opponentsOrdered.length >= CROWDED_MIN_OPPONENTS;
              // A real 9-max table: the hero owns the bottom seat (rendered separately),
              // and these eight slots ring the rest of the table. When the reducer has
              // resolved absolute seats, each opponent is placed at the slot RELATIVE to
              // the hero (so the hero always sits at the bottom and everyone else fans out
              // by their chosen seat); otherwise opponents fall back to a top-outward fill.
              // Unfilled slots show an open seat the hero can click to sit / move to.
              const seatOf = new Array<string | null>(OPPONENT_SEAT_COUNT).fill(null);
              const useAbsoluteSeats = Boolean(seatByPeer && mySeat != null);
              if (useAbsoluteSeats) {
                for (const opp of opponentsOrdered) {
                  const abs = seatByPeer!.get(opp);
                  if (abs == null) continue;
                  const rel = (abs - mySeat! + SEAT_COUNT) % SEAT_COUNT; // 1..8 for opponents
                  if (rel >= 1 && rel <= OPPONENT_SEAT_COUNT) seatOf[rel - 1] = opp;
                }
                // Safety net: seat any opponent the reducer didn't place into a free slot.
                let free = 0;
                for (const opp of opponentsOrdered) {
                  if (seatOf.includes(opp)) continue;
                  while (free < OPPONENT_SEAT_COUNT && seatOf[free]) free++;
                  if (free >= OPPONENT_SEAT_COUNT) break;
                  seatOf[free] = opp;
                }
              } else {
                opponentsOrdered.forEach((opp, i) => {
                  if (i < OPPONENT_SEAT_COUNT) seatOf[SEAT_FILL_ORDER[i]] = opp;
                });
              }
              // A single "spotlight" that GLIDES to the OPPONENT whose turn it is, lighting
              // their seat instead of a badge on their head. (The hero's own turn lights the
              // hero's own avatar in MySeat, not this oval light.) The left/top transition (in
              // CSS) makes the light sweep smoothly from one seat to the next.
              let spotlightCoord: { x: number; y: number } | null = null;
              if (whoseTurn && !currentRoundFinished && whoseTurn !== playerId) {
                const slot = seatOf.indexOf(whoseTurn);
                if (slot >= 0) spotlightCoord = ovalSeatCoord(slot, isNarrow);
              }
              const seatNodes: React.ReactElement[] = [];
              if (spotlightCoord) {
                seatNodes.push(
                  <div
                    key="turn-spotlight"
                    className="turn-spotlight"
                    style={{ left: `${spotlightCoord.x}%`, top: `${spotlightCoord.y}%` }}
                    aria-hidden="true"
                  />,
                );
              }
              seatOf.forEach((opponent, seat) => {
                if (!opponent) {
                  const canSit = useAbsoluteSeats && Boolean(onTakeSeat);
                  const absSeat = ((mySeat ?? 0) + seat + 1) % SEAT_COUNT;
                  seatNodes.push(
                    <div
                      key={`empty-${seat}`}
                      className="opponent opponent-empty"
                      style={ovalSeatStyle(seat, OPPONENT_SEAT_COUNT, isNarrow, crowded)}
                      data-testid={`empty-seat-${seat}`}
                    >
                      {canSit ? (
                        <button
                          type="button"
                          className="empty-seat empty-seat-button"
                          onClick={() => onTakeSeat!(absSeat)}
                          aria-label={t('sitHere')}
                          title={t('sitHere')}
                        >
                          <span aria-hidden="true">+</span>
                        </button>
                      ) : (
                        <div className="empty-seat" aria-hidden="true" />
                      )}
                    </div>,
                  );
                  return;
                }
                const oppIndex = opponentsOrdered.indexOf(opponent);
                const hasFolded = actionsDone?.get(opponent) === 'fold';
                seatNodes.push(
                  <div
                    key={opponent}
                    className={hasFolded ? 'opponent opponent-folded' : 'opponent'}
                    data-testid={`opponent-${oppIndex}`}
                    style={ovalSeatStyle(seat, OPPONENT_SEAT_COUNT, isNarrow, crowded)}
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
                    <div className="bankroll">${bankrolls.get(opponent) ?? 0}</div>
                    {renderSessionPnl(opponent)}
                    {board && <HandCards hole={holesPerPlayer?.get(opponent)}/>}
                    {
                      actionsDone && <BetAmount playerId={opponent} actionsDone={actionsDone}/>
                    }
                  </div>,
                );
              });
              return seatNodes;
            })()}
            {flyingChips.map(chip => (
              <span
                key={chip.id}
                className="chip-fly"
                aria-hidden="true"
                style={{
                  left: `${chip.x}%`,
                  top: `${chip.y}%`,
                  ['--dx' as string]: chip.dx.toFixed(2),
                  ['--dy' as string]: chip.dy.toFixed(2),
                }}
              />
            ))}
          </div>
        )
      }
    </>
  );
}
