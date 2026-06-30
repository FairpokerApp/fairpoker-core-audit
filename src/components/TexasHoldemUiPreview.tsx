import React, {useMemo} from "react";
import {handRank} from "phe";

import '../App.css';

import MessageBar from "./MessageBar";
import MySeat from "./MySeat";
import Opponents from "./Opponents";
import PokerTable from "./PokerTable";
import ScoreBoardAndToggle from "./ScoreBoardAndToggle";
import SecurityStatusBar from "./SecurityStatusBar";
import FloatingInviteButton from "./FloatingInviteButton";
import GameAudioToggle from "./GameAudioToggle";
import AccountHomeButton from "./AccountHomeButton";
import LeaveSeatButton from "./LeaveSeatButton";
import PlayerAvatar from "./PlayerAvatar";
import {Board, Hole, evaluateStandardCards} from "../lib/rules";
import {StandardCard} from "../lib/secureMentalPoker";
import {Messages} from "../lib/useMessages";
import {EventLogs} from "../lib/texas-holdem/useEventLogs";
import {TexasHoldemRoundSettings, WinningResult} from "../lib/texas-holdem/TexasHoldemGameRoom";
import {useI18n} from "../lib/i18n";
import {WorkerRoomState} from "../lib/CloudflareRelayTransport";

type PreviewState =
  | 'single-lobby'
  | 'two-lobby'
  | 'two-preflop-turn'
  | 'two-flop-waiting'
  | 'three-river-turn'
  | 'four-showdown'
  | 'six-lobby'
  | 'six-river-turn'
  | 'nine-river-turn'
  | 'nine-flop-waiting'
  | 'chat-open'
  | 'chat-collapsed'
  | 'scoreboard'
  | 'last-one-wins'
  | 'final-hand-live'
  | 'match-complete'
  | 'seat-lost'
  | 'registration-lobby'
  | 'spectator-rail'
  | 'queued-next-hand'
  | 'shuffle-overlay';

type PreviewModel = {
  members: string[];
  players?: string[];
  board: Board;
  currentRoundFinished: boolean;
  whoseTurn?: string;
  callAmount?: number;
  actionsDone?: Map<string, string | number>;
  winningResult?: WinningResult;
  seriesProgress?: {
    current: number;
    total: number;
    complete: boolean;
  };
  roundSettings?: TexasHoldemRoundSettings;
  isRejoinBlocked?: boolean;
  isQueuedForNextHand?: boolean;
  roomState?: WorkerRoomState;
  railPlayers?: Array<{
    peerId: string;
    status: 'watching' | 'timedOut' | 'sittingOut' | 'offline' | 'active';
    seated: boolean;
  }>;
};

const me = 'player-me';
const allPlayers = [
  me,
  'player-alice',
  'player-bruno',
  'player-carmen',
  'player-diego',
  'player-echo',
  'player-finn',
  'player-gina',
  'player-hugo',
];

const c = (suit: StandardCard['suit'], rank: StandardCard['rank']): StandardCard => ({suit, rank});

const boardByStage = {
  preflop: [] as Board,
  flop: [c('Club', '2'), c('Diamond', '7'), c('Heart', 'A')] as Board,
  river: [c('Club', '2'), c('Diamond', '7'), c('Heart', 'A'), c('Spade', 'J'), c('Club', 'T')] as Board,
};

const holes = new Map<string, Hole>([
  [me, [c('Spade', 'A'), c('Heart', 'K')]],
  ['player-alice', [c('Diamond', 'A'), c('Club', 'K')]],
  ['player-bruno', [c('Spade', '9'), c('Heart', '9')]],
  ['player-carmen', [c('Club', 'Q'), c('Diamond', 'Q')]],
  ['player-diego', [c('Spade', '4'), c('Heart', '4')]],
  ['player-echo', [c('Club', '8'), c('Diamond', '8')]],
  ['player-finn', [c('Spade', '5'), c('Heart', '6')]],
  ['player-gina', [c('Club', 'J'), c('Diamond', 'T')]],
  ['player-hugo', [c('Spade', '2'), c('Heart', '3')]],
]);

const names = new Map<string, string>([
  [me, 'You'],
  ['player-alice', 'Alice'],
  ['player-bruno', 'Bruno'],
  ['player-carmen', 'Carmen'],
  ['player-diego', 'Diego'],
  ['player-echo', 'Echo'],
  ['player-finn', 'Finn'],
  ['player-gina', 'Gina'],
  ['player-hugo', 'Hugo'],
]);

const bankrolls = new Map<string, number>([
  [me, 126],
  ['player-alice', 88],
  ['player-bruno', 104],
  ['player-carmen', 73],
  ['player-diego', 140],
  ['player-echo', 95],
  ['player-finn', 112],
  ['player-gina', 67],
  ['player-hugo', 154],
]);

const scoreBoard = new Map<string, number>([
  [me, 26],
  ['player-bruno', 4],
  ['player-echo', -5],
  ['player-alice', -12],
  ['player-carmen', -27],
  ['player-diego', 14],
]);

const totalDebt = new Map<string, number>();

const messages: Messages = [
  {type: 'message', whose: 'player-alice', text: 'Nice river.', timestamp: 1},
  {type: 'message', whose: me, text: 'Calling this one.', timestamp: 3},
];

const eventLogs: EventLogs = [
  {type: 'newRound', round: 3, players: allPlayers, timestamp: 0},
  {type: 'raise', playerId: 'player-carmen', raisedAmount: 12, allin: false, timestamp: 2},
  {type: 'check', playerId: me, timestamp: 4},
];

const roundSettings: TexasHoldemRoundSettings = {
  initialFundAmount: 100,
  smallBlindAmount: 1,
  bigBlindAmount: 2,
  plannedRounds: 10,
  autoFoldTimeoutSeconds: 60,
};

const previewAudio = {
  enabled: false,
  toggle: async () => {},
  play: () => {},
  speak: () => {},
};

const noopActions = {
  fireBet: async () => {},
  fireFold: async () => {},
  sitOut: async () => {},
  returnToTable: async () => {},
};

const previewRoomState = (overrides: Partial<WorkerRoomState> = {}): WorkerRoomState => ({
  version: 2,
  source: 'cloudflare-worker',
  roomId: 'preview-table',
  generatedAt: Date.now(),
  viewerPeerId: me,
  latestEventSeq: 1,
  currentRound: null,
  currentPlayers: [],
  currentTurn: null,
  players: [
    {peerId: me, online: true, connected: true, seated: false, status: 'watching', spectator: true},
    {peerId: 'player-alice', online: true, connected: true, seated: true, status: 'active'},
    {peerId: 'player-bruno', online: true, connected: true, seated: true, status: 'active'},
  ],
  spectators: [
    {peerId: me, online: true, connected: true, seated: false, status: 'watching', spectator: true},
  ],
  activePlayerCount: 2,
  spectatorCount: 1,
  onlineCount: 3,
  roomValid: true,
  playable: true,
  reason: 'ready',
  ...overrides,
});

const actionMap = (entries: Array<[string, string | number]>) => new Map<string, string | number>(entries);

function stateFromQuery(): PreviewState {
  const param = new URLSearchParams(window.location.search).get('uiPreview') as PreviewState | null;
  return param || 'two-preflop-turn';
}

function pickState(state: PreviewState): PreviewModel {
  switch (state) {
    case 'single-lobby':
      return {members: allPlayers.slice(0, 1), players: undefined, board: boardByStage.preflop, currentRoundFinished: true};
    case 'two-lobby':
      return {members: allPlayers.slice(0, 2), players: undefined, board: boardByStage.preflop, currentRoundFinished: true};
    case 'two-preflop-turn':
      return {members: allPlayers.slice(0, 2), players: allPlayers.slice(0, 2), board: boardByStage.preflop, currentRoundFinished: false, whoseTurn: me, callAmount: 2, actionsDone: actionMap([[me, 1], ['player-alice', 2]])};
    case 'two-flop-waiting':
      return {members: allPlayers.slice(0, 2), players: allPlayers.slice(0, 2), board: boardByStage.flop, currentRoundFinished: false, whoseTurn: 'player-alice', callAmount: 0, actionsDone: actionMap([[me, 'check'], ['player-alice', 'check']])};
    case 'three-river-turn':
      return {members: allPlayers.slice(0, 3), players: allPlayers.slice(0, 3), board: boardByStage.river, currentRoundFinished: false, whoseTurn: me, callAmount: 18, actionsDone: actionMap([[me, 10], ['player-alice', 18], ['player-bruno', 'fold']])};
    case 'four-showdown':
    case 'scoreboard':
      return {members: allPlayers.slice(0, 4), players: allPlayers.slice(0, 4), board: boardByStage.river, currentRoundFinished: true, whoseTurn: undefined, callAmount: 0, actionsDone: actionMap([[me, 10], ['player-alice', 18], ['player-bruno', 'fold'], ['player-carmen', 18]]), roundSettings};
    case 'last-one-wins':
      return {
        members: allPlayers.slice(0, 3),
        players: allPlayers.slice(0, 3),
        board: boardByStage.flop,
        currentRoundFinished: true,
        callAmount: 0,
        actionsDone: actionMap([[me, 'fold'], ['player-alice', 18], ['player-bruno', 'fold']]),
        winningResult: {how: 'LastOneWins', round: 4, winner: 'player-alice'},
        roundSettings,
      };
    case 'final-hand-live':
      return {
        members: allPlayers.slice(0, 3),
        players: allPlayers.slice(0, 3),
        board: boardByStage.flop,
        currentRoundFinished: false,
        whoseTurn: me,
        callAmount: 6,
        actionsDone: actionMap([[me, 2], ['player-alice', 6], ['player-bruno', 'check']]),
        seriesProgress: {current: 10, total: 10, complete: true},
        roundSettings,
      };
    case 'match-complete':
      return {
        members: allPlayers.slice(0, 4),
        players: allPlayers.slice(0, 4),
        board: boardByStage.river,
        currentRoundFinished: true,
        callAmount: 0,
        actionsDone: actionMap([[me, 10], ['player-alice', 18], ['player-bruno', 'fold'], ['player-carmen', 18]]),
        seriesProgress: {current: 10, total: 10, complete: true},
        roundSettings,
      };
    case 'seat-lost':
      return {
        members: allPlayers.slice(0, 3),
        players: allPlayers.slice(1, 3),
        board: boardByStage.flop,
        currentRoundFinished: false,
        whoseTurn: 'player-alice',
        callAmount: 6,
        actionsDone: actionMap([['player-alice', 6]]),
        isRejoinBlocked: true,
      };
    case 'registration-lobby':
      return {
        members: allPlayers.slice(0, 3),
        players: undefined,
        board: boardByStage.preflop,
        currentRoundFinished: true,
        roomState: previewRoomState(),
      };
    case 'spectator-rail':
      return {
        members: allPlayers.slice(0, 4),
        players: allPlayers.slice(0, 2),
        board: boardByStage.flop,
        currentRoundFinished: false,
        whoseTurn: 'player-alice',
        callAmount: 6,
        actionsDone: actionMap([[me, 2], ['player-alice', 6]]),
        railPlayers: [
          {peerId: 'player-bruno', status: 'watching', seated: false},
          {peerId: 'player-carmen', status: 'active', seated: true},
        ],
      };
    case 'queued-next-hand':
      return {
        members: allPlayers.slice(0, 3),
        players: allPlayers.slice(1, 3),
        board: boardByStage.flop,
        currentRoundFinished: false,
        whoseTurn: 'player-alice',
        callAmount: 6,
        actionsDone: actionMap([['player-alice', 6]]),
        isQueuedForNextHand: true,
        railPlayers: [
          {peerId: me, status: 'active', seated: true},
        ],
      };
    case 'shuffle-overlay':
      return {
        members: allPlayers.slice(0, 2),
        players: allPlayers.slice(0, 2),
        board: boardByStage.river,
        currentRoundFinished: true,
        actionsDone: actionMap([[me, 2], ['player-alice', 2]]),
        roundSettings,
      };
    case 'six-lobby':
      return {members: allPlayers, players: undefined, board: boardByStage.preflop, currentRoundFinished: true};
    case 'nine-river-turn':
      return {
        members: allPlayers,
        players: allPlayers,
        board: boardByStage.river,
        currentRoundFinished: false,
        whoseTurn: me,
        callAmount: 24,
        actionsDone: actionMap([
          [me, 12], ['player-alice', 24], ['player-bruno', 'fold'], ['player-carmen', 24],
          ['player-diego', 'all-in'], ['player-echo', 24], ['player-finn', 'fold'],
          ['player-gina', 24], ['player-hugo', 'fold'],
        ]),
      };
    case 'nine-flop-waiting':
      return {
        members: allPlayers,
        players: allPlayers,
        board: boardByStage.flop,
        currentRoundFinished: false,
        whoseTurn: 'player-gina',
        callAmount: 6,
        actionsDone: actionMap([
          [me, 'check'], ['player-alice', 6], ['player-bruno', 6], ['player-carmen', 'fold'],
          ['player-diego', 6], ['player-echo', 'check'], ['player-finn', 6],
          ['player-gina', 2], ['player-hugo', 'check'],
        ]),
      };
    case 'six-river-turn':
    case 'chat-open':
    case 'chat-collapsed':
      return {members: allPlayers, players: allPlayers, board: boardByStage.river, currentRoundFinished: false, whoseTurn: me, callAmount: 24, actionsDone: actionMap([[me, 12], ['player-alice', 24], ['player-bruno', 'fold'], ['player-carmen', 24], ['player-diego', 'all-in'], ['player-echo', 24]])};
  }
}

export default function TexasHoldemUiPreview() {
  const {t} = useI18n();
  const state = stateFromQuery();
  const preview = pickState(state);
  const shouldShowChat = state === 'chat-open' || state === 'chat-collapsed';
  const board = preview.board;
  const players = preview.players;
  const winningResult: WinningResult | undefined = useMemo(() => {
    if (preview.winningResult) {
      return preview.winningResult;
    }
    if (!preview.currentRoundFinished || board.length !== 5) {
      return undefined;
    }
    const winner = players?.[3] ?? me;
    const winnerHole = holes.get(winner)!;
    const cards = [...board, ...winnerHole];
    const strength = evaluateStandardCards(cards);
    return {
      how: 'Showdown',
      round: 3,
      showdown: [{
        players: [winner],
        handValue: handRank(strength),
        strength,
      }],
    };
  }, [board, players, preview.currentRoundFinished, preview.winningResult]);
  const mainPotWinners = winningResult?.how === 'Showdown'
    ? new Set(winningResult.showdown[0].players)
    : winningResult?.how === 'LastOneWins'
      ? new Set([winningResult.winner])
      : null;
  const seriesProgress = preview.seriesProgress ?? {current: players ? 3 : 0, total: 10, complete: false};
  const continueAfterPlannedHands = false;
  const matchComplete = !continueAfterPlannedHands && seriesProgress.complete && preview.currentRoundFinished;
  const previewRound = players ? 3 : undefined;
  const railStatusLabel = (status: string, seated: boolean) => {
    if (seated) {
      return t('queuedForNextHand');
    }
    switch (status) {
      case 'timedOut':
        return t('railTimedOut');
      case 'sittingOut':
        return t('railSittingOut');
      case 'offline':
        return t('railOffline');
      default:
        return t('watching');
    }
  };

  return (
    <div className={`App ui-preview ui-preview-${state}`} data-preview-state={state}>
      <div className="fairpoker-quick-actions" aria-label={t('tableTools')}>
        <LeaveSeatButton
          disabled={!players?.includes(me)}
          onLeaveSeat={async () => undefined}
        />
        <SecurityStatusBar
          peerState="PeerServerConnected"
          playerId={me}
          members={preview.members}
          players={players}
          round={previewRound}
          seriesProgress={seriesProgress}
          currentRoundFinished={preview.currentRoundFinished}
          boardCardsCount={board.length}
          whoseTurn={preview.whoseTurn}
          audio={previewAudio}
        />
        <FloatingInviteButton playerId={me} />
        <GameAudioToggle audio={previewAudio} />
        <AccountHomeButton />
      </div>
      {(preview.isRejoinBlocked || preview.isQueuedForNextHand) && (
        <div className="seat-recovery-panel seat-recovery-with-action" role="status" aria-live="polite" data-testid="seat-recovery-panel">
          <i aria-hidden="true" />
          <strong>{preview.isQueuedForNextHand ? t('queuedForNextHandTitle') : t('seatLostTitle')}</strong>
          <span>{preview.isQueuedForNextHand ? t('queuedForNextHandCopy') : t('seatLostCopy')}</span>
          <button
            type="button"
            className="seat-recovery-button"
            disabled={preview.isQueuedForNextHand}
            data-testid="return-to-table-button"
          >
            {preview.isQueuedForNextHand ? t('returnToTablePending') : t('returnToTable')}
          </button>
        </div>
      )}
      {preview.railPlayers && preview.railPlayers.length > 0 && (
        <aside className="spectator-rail" aria-label={t('spectatorList')} data-testid="spectator-rail">
          <strong>{t('spectatorList')}</strong>
          <div>
            {preview.railPlayers.map(player => (
              <div className="spectator-rail-item" key={player.peerId}>
                <PlayerAvatar
                  playerId={player.peerId}
                  playerName={names.get(player.peerId) ?? player.peerId}
                />
                <span>{railStatusLabel(player.status, player.seated)}</span>
              </div>
            ))}
          </div>
        </aside>
      )}
      {previewRound && (
        <ScoreBoardAndToggle
          scoreBoard={scoreBoard}
          totalDebt={totalDebt}
          bankrolls={bankrolls}
          names={names}
          lastWinningResult={winningResult}
          mainPotWinners={mainPotWinners}
          holesPerPlayer={holes}
          board={board}
          playerId={me}
          matchComplete={matchComplete}
          canRestartMatch={matchComplete}
          onRestartMatch={async () => {}}
        />
      )}
      <div className="poker-felt">
      {!matchComplete && (
        <Opponents
          members={preview.members}
          playerId={me}
          players={players}
          names={names}
          bankrolls={bankrolls}
          board={board}
          whoseTurn={preview.whoseTurn}
          holesPerPlayer={holes}
          mainPotWinners={mainPotWinners}
          lastWinningResult={winningResult}
          scoreBoard={scoreBoard}
          currentRoundFinished={preview.currentRoundFinished}
          actionsDone={preview.actionsDone ?? null}
        />
      )}
      <PokerTable
        members={preview.members}
        playerId={me}
        players={players}
        round={previewRound}
        board={board}
        potAmount={state.includes('six') ? 144 : 48}
        currentRoundFinished={preview.currentRoundFinished}
        lastWinningResult={winningResult}
        startGame={async () => {}}
        roundSettings={preview.roundSettings}
        seriesProgress={seriesProgress}
        names={names}
        shuffleOverlayStartedAt={state === 'shuffle-overlay' ? Date.now() : undefined}
        roomState={preview.roomState}
        onReturnToTable={async () => {}}
      />
      </div>
      {!matchComplete && !preview.isQueuedForNextHand && (
        <MySeat
          playerId={me}
          players={players}
          board={board}
          hole={preview.isRejoinBlocked ? undefined : holes.get(me)}
          potAmount={state.includes('six') ? 144 : 48}
          bankrolls={bankrolls}
          names={names}
          setMyName={() => {}}
          mainPotWinners={mainPotWinners}
          currentRoundFinished={preview.currentRoundFinished}
          isRejoinBlocked={preview.isRejoinBlocked}
          connectionStatus={preview.isRejoinBlocked ? 'warn' : 'good'}
          actionsDone={preview.actionsDone ?? null}
          whoseTurnAndCallAmount={preview.whoseTurn ? {whoseTurn: preview.whoseTurn, callAmount: preview.callAmount ?? 0} : null}
          actions={noopActions}
        />
      )}
      {shouldShowChat && !matchComplete && (
        <MessageBar
          playerId={me}
          names={names}
          eventLogs={eventLogs}
          messages={messages}
          onMessage={() => {}}
          defaultCollapsed={state !== 'chat-open'}
        />
      )}
    </div>
  );
}
