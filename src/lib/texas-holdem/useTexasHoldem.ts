import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {GameRoomStatus} from "../GameRoom";
import {TexasHoldem, TableId} from "../setup";
import {Board, Hole} from "../rules";
import {
  DEFAULT_AUTO_FOLD_TIMEOUT_SECONDS,
  DEFAULT_BIG_BLIND_AMOUNT,
  DEFAULT_ENCRYPTION_BITS,
  DEFAULT_PLANNED_ROUNDS,
  DEFAULT_SMALL_BLIND_AMOUNT,
  TexasHoldemGameRoomEvents,
  HandPauseState,
  TexasHoldemRoundSettings,
  TexasHoldemTableEvent,
  WinningResult,
} from "./TexasHoldemGameRoom";
import {TranscriptSnapshot} from "../fairness/transcript";
import {
  reduceTexasHoldem,
  transcriptToReducerEvents,
  reducedActionsByPlayer,
  cardRevealsFromHands,
  FundsCheckpoint,
} from "./texasHoldemReducer";

export interface TexasHoldemRoundHistoryItem {
  round: number;
  players: string[];
  board: Board;
  holesPerPlayer?: Map<string, Hole>;
  winningResult?: WinningResult;
}

// S4: persist resolved-hand history locally so 战绩 survives a page refresh (today it
// lives only in React state and is wiped on reload). Keyed by table; capped to the last
// 80 hands. Cards stored here are already public (a hand only enters history once it has
// a winningResult, i.e. after showdown/fold-out). (BROWSER_AUTHORITATIVE_REWORK_PLAN S4.)
const HISTORY_STORAGE_PREFIX = 'fairpoker:history:';
const HISTORY_CAP = 80;

function loadPersistedHistory(roomKey: string): TexasHoldemRoundHistoryItem[] {
  if (!roomKey || typeof localStorage === 'undefined') {
    return [];
  }
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_PREFIX + roomKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && typeof (item as any).round === 'number')
      .map((item: any) => ({
        round: item.round,
        players: Array.isArray(item.players) ? item.players : [],
        board: Array.isArray(item.board) ? item.board : [],
        holesPerPlayer: Array.isArray(item.holesPerPlayer) ? new Map(item.holesPerPlayer) : undefined,
        winningResult: item.winningResult,
      }));
  } catch {
    return [];
  }
}

function savePersistedHistory(roomKey: string, history: TexasHoldemRoundHistoryItem[]): void {
  if (!roomKey || typeof localStorage === 'undefined') {
    return;
  }
  try {
    const resolved = history.filter(item => item.winningResult).slice(-HISTORY_CAP);
    localStorage.setItem(HISTORY_STORAGE_PREFIX + roomKey, JSON.stringify(resolved.map(item => ({
      round: item.round,
      players: item.players,
      board: item.board,
      holesPerPlayer: item.holesPerPlayer ? Array.from(item.holesPerPlayer.entries()) : undefined,
      winningResult: item.winningResult,
    }))));
  } catch {
    // storage full / unavailable — history persistence is best-effort.
  }
}

// Durable funds checkpoint: the chips each player holds between hands, saved locally so a
// refresh/reopen re-derives correct bankrolls. The relay only replays the CURRENT hand, so
// without this a reopened client would recompute everyone's funds from a blank slate (the
// "刷新后筹码清零 / 卡 $0 / 两端对不上" bug). Saved AFTER a hand resolves, so it already
// includes that hand's showdown result — no past card reveals needed on reload.
const CHECKPOINT_STORAGE_PREFIX = 'fairpoker:funds-checkpoint:';

function loadFundsCheckpoint(roomKey: string): FundsCheckpoint | undefined {
  if (!roomKey || typeof localStorage === 'undefined') {
    return undefined;
  }
  try {
    const raw = localStorage.getItem(CHECKPOINT_STORAGE_PREFIX + roomKey);
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.throughRound !== 'number' || !Array.isArray(parsed.funds)) {
      return undefined;
    }
    return {
      throughRound: parsed.throughRound,
      funds: new Map(parsed.funds),
      boughtIn: new Map(Array.isArray(parsed.boughtIn) ? parsed.boughtIn : []),
    };
  } catch {
    return undefined;
  }
}

function saveFundsCheckpoint(roomKey: string, checkpoint: FundsCheckpoint): void {
  if (!roomKey || typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(CHECKPOINT_STORAGE_PREFIX + roomKey, JSON.stringify({
      throughRound: checkpoint.throughRound,
      funds: Array.from(checkpoint.funds.entries()),
      boughtIn: Array.from(checkpoint.boughtIn.entries()),
    }));
  } catch {
    // storage full / unavailable — checkpoint persistence is best-effort.
  }
}

function useMyPlayerId() {
  const [peerId, setPeerId] = useState<string | undefined>(() => TexasHoldem.peerId);
  useEffect(() => {
    const peerIdListener = (peerIdAssigned: string) => setPeerId(peerIdAssigned);
    if (TexasHoldem.peerId) {
      setPeerId(TexasHoldem.peerId);
    }
    TexasHoldem.listener.on('connected', peerIdListener);
    return () => {
      TexasHoldem.listener.off('connected', peerIdListener);
    }
  }, []);
  return peerId;
}

function generateLocalActionId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

function useStatus() {
  const [status, setStatus] = useState<GameRoomStatus>(() => TexasHoldem.status ?? 'NotReady');
  useEffect(() => {
    const statusListener = (statusChanged: GameRoomStatus) => setStatus(statusChanged);
    setStatus(TexasHoldem.status ?? 'NotReady');
    TexasHoldem.listener.on('status', statusListener);
    return () => {
      TexasHoldem.listener.off('status', statusListener);
    }
  }, []);
  return status;
}

function useGameSetup() {
  const [members, setMembers] = useState<string[]>(() => [...(TexasHoldem.members ?? [])]);

  useEffect(() => {
    const membersListener = (membersUpdated: string[]) => {
      setMembers([...membersUpdated]);
    };
    setMembers([...(TexasHoldem.members ?? [])]);
    TexasHoldem.listener.on('members', membersListener);
    return () => {
      TexasHoldem.listener.off('members', membersListener);
    };
  }, []);

  const initialSnapshot = TexasHoldem.getStateSnapshot();
  const [playersByRound, setPlayersByRound] = useState<Map<number, string[]>>(
    () => new Map(Array.from(initialSnapshot.playersByRound.entries()).map(([round, roundPlayers]) => [round, [...roundPlayers]])),
  );
  const [currentRound, setCurrentRound] = useState<number | undefined>(() => initialSnapshot.currentRound);
  const [players, setPlayers] = useState<string[] | undefined>(() => {
    const round = initialSnapshot.currentRound;
    return round ? initialSnapshot.playersByRound.get(round) : undefined;
  });

  useEffect(() => {
    const newRoundListener = (round: number, players: string[]) => {
      setCurrentRound(round);
      setPlayers(players);
      setPlayersByRound(prev => {
        const next = new Map(prev);
        next.set(round, [...players]);
        return next;
      });
    };
    const winnerListener: TexasHoldemGameRoomEvents['winner'] = (result) => {
      setCurrentRound(prev => prev ?? result.round);
      setPlayers(prev => {
        if (prev?.length) {
          return prev;
        }
        const playersFromSnapshot = TexasHoldem.getStateSnapshot().playersByRound.get(result.round);
        if (playersFromSnapshot) {
          setPlayersByRound(previous => {
            const next = new Map(previous);
            next.set(result.round, [...playersFromSnapshot]);
            return next;
          });
        }
        return playersFromSnapshot ? [...playersFromSnapshot] : prev;
      });
    };
    TexasHoldem.listener.on('players', newRoundListener);
    TexasHoldem.listener.on('winner', winnerListener);
    return () => {
      TexasHoldem.listener.off('players', newRoundListener);
      TexasHoldem.listener.off('winner', winnerListener);
    };
  }, []);

  const smallBlind = useMemo(() => players ? players[0] : undefined, [players]);
  const bigBlind = useMemo(() => players ? players[1] : undefined, [players]);
  const button = useMemo(() => players ? players[players.length - 1] : undefined, [players]);

  return {
    members,
    players,
    smallBlind,
    bigBlind,
    button,
    currentRound,
    playersByRound,
  };
}

function useBankrolls() {
  const [bankrolls, setBankrolls] = useState<Map<string, number>>(() => TexasHoldem.getStateSnapshot().bankrolls);
  useEffect(() => {
    const fundListener: TexasHoldemGameRoomEvents['fund'] = (fund, previousFund, whose) => {
      setBankrolls(prev => {
        const newBankrolls = new Map(prev);
        newBankrolls.set(whose, fund);
        return newBankrolls;
      });
    };
    TexasHoldem.listener.on('fund', fundListener);
    return () => {
      TexasHoldem.listener.off('fund', fundListener);
    };
  }, []);

  return bankrolls;
}

function useScoreBoard() {
  const [scoreBoard, setScoreBoard] = useState<Map<string, number>>(new Map());
  const [handScoreBoard, setHandScoreBoard] = useState<Map<string, number>>(new Map());
  const [totalDebt, setTotalDebt] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    const newRoundListener: TexasHoldemGameRoomEvents['players'] = () => {
      setHandScoreBoard(new Map());
    };
    const fundListener: TexasHoldemGameRoomEvents['fund'] = (fund, previousFund, whose, borrowed) => {
      const diff = fund - (previousFund ?? 0);
      if (!borrowed) {
        setScoreBoard(prev => {
          const next = new Map(prev);
          next.set(whose, (next.get(whose) ?? 0) + diff);
          return next;
        });
        setHandScoreBoard(prev => {
          const next = new Map(prev);
          next.set(whose, (next.get(whose) ?? 0) + diff);
          return next;
        });
      }
      if (borrowed) {
        setTotalDebt(prev => {
          const next = new Map(prev);
          next.set(whose, (next.get(whose) ?? 0) + diff);
          return next;
        })
      }
    };
    TexasHoldem.listener.on('players', newRoundListener);
    TexasHoldem.listener.on('fund', fundListener);
    return () => {
      TexasHoldem.listener.off('players', newRoundListener);
      TexasHoldem.listener.off('fund', fundListener);
    };
  }, []);

  return {
    scoreBoard,
    handScoreBoard,
    totalDebt,
  };
}

export type BoardStage =
  | 'Preflop'
  | 'Flop'
  | 'Turn'
  | 'River'
  ;

function useBoard(round: number | undefined) {
  const [boardPerRound, setBoardPerRound] = useState<Map<number, Board>>(() => TexasHoldem.getStateSnapshot().boardByRound);
  useEffect(() => {
    const boardListener = (round: number, board: Board) => {
      setBoardPerRound(prev => {
        const next = new Map(prev);
        next.set(round, board);
        return next;
      });
    }
    TexasHoldem.listener.on('board', boardListener);
    return () => {
      TexasHoldem.listener.off('board', boardListener);
    };
  }, []);

  const board: Board = useMemo(() => round ? (boardPerRound.get(round) ?? []) : [], [boardPerRound, round]);

  const boardStage: BoardStage | undefined = useMemo(() => {
    switch (board.length) {
      case 0:
        return 'Preflop';
      case 3:
        return 'Flop';
      case 4:
        return 'Turn';
      case 5:
        return 'River';
    }
  }, [board]);

  return {
    board,
    boardStage,
    boardPerRound,
  };
}

function useHoles(round: number | undefined, myPlayerId: string | undefined) {
  const [holesPerPlayerPerRound, setHolesPerPlayerPerRound] = useState<Map<number, Map<string, Hole>>>(() => TexasHoldem.getStateSnapshot().holesByRound);
  useEffect(() => {
    const holeListener = (round: number, whose: string, hole: Hole) => {
      setHolesPerPlayerPerRound(prev => {
        const next = new Map(prev);
        const holesPerPlayer: Map<string, Hole> = next.get(round) ?? new Map();
        holesPerPlayer.set(whose, hole);
        next.set(round, holesPerPlayer);
        return next;
      });
    }
    TexasHoldem.listener.on('hole', holeListener);
    return () => {
      TexasHoldem.listener.off('hole', holeListener);
    };
  }, []);

  const holesPerPlayer = useMemo(() =>
      round ? holesPerPlayerPerRound.get(round) : undefined,
    [holesPerPlayerPerRound, round]);

  const myHole: Hole | undefined = useMemo(() => {
    if (!myPlayerId || !holesPerPlayer) {
      return undefined;
    }
    return holesPerPlayer.get(myPlayerId);
  }, [holesPerPlayer, myPlayerId]);

  return {
    myHole,
    holesPerPlayer,
    holesPerPlayerPerRound,
  }
}

function useWhoseTurnAndCallAmount(round: number | undefined) {
  const [whoseTurnPerRound, setWhoseTurnPerRound] = useState<Map<number, { whoseTurn: string, callAmount: number } | null>>(() => TexasHoldem.getStateSnapshot().whoseTurnByRound);
  useEffect(() => {
    const whoseTurnListener = (round: number, whoseTurn: string | null, actionMeta?: { callAmount: number }) => {
      setWhoseTurnPerRound(prev => {
        const next = new Map(prev);
        next.set(round, whoseTurn ? { whoseTurn, callAmount: actionMeta?.callAmount ?? 0 } : null);
        return next;
      });
    };
    TexasHoldem.listener.on('whoseTurn', whoseTurnListener);
    return () => {
      TexasHoldem.listener.off('whoseTurn', whoseTurnListener);
    };
  }, []);

  return useMemo(() => round ? whoseTurnPerRound.get(round) ?? null : null, [round, whoseTurnPerRound]);
}

function usePotAmount() {
  const [potAmount, setPotAmount] = useState<number>(() => TexasHoldem.getStateSnapshot().potAmount);
  useEffect(() => {
    const potListener = (round: number, amount: number) => {
      setPotAmount(amount);
    };
    TexasHoldem.listener.on('pot', potListener);
    return () => {
      TexasHoldem.listener.off('pot', potListener);
    };
  }, []);

  return potAmount;
}

type Action =
  | 'fold'
  | 'all-in'
  | Array<{
  bet: number,
  uid: string, // used to de-deduplicate
}>

function useActionsDone(round: number | undefined) {
  const [actionsPerRound, setActionsPerRound] = useState<Map<number, Map<string, Action>>>(new Map());
  const updateActionByWhom = useCallback((round: number, who: string, didWhat: number | 'fold' | 'all-in') => {
    // this is a workaround currently to avoid duplicate invocation of the state setter in StrictMode
    const uid = generateLocalActionId(); // TODO: generate from GameRoom
    setActionsPerRound(prev => {
      const next = new Map(prev);
      const actions: Map<string, Action> = next.get(round) ?? new Map();
      const prevAction = actions.get(who);
      if (!prevAction) {
        actions.set(who, typeof didWhat === 'string' ? didWhat : [{uid, bet: didWhat}]);
      } else if (typeof prevAction === 'string') {
        return prev; // do nothing
      } else if (typeof didWhat === 'string') {
        actions.set(who, didWhat);
      } else {
        actions.set(who, [...prevAction, {uid, bet: didWhat}]);
      }
      next.set(round, actions);
      return next;
    });
  }, []);

  useEffect(() => {
    const betListener = (round: number, amount: number, who: string, allin: boolean) => {
      updateActionByWhom(round, who, allin ? 'all-in' : amount);
    };
    TexasHoldem.listener.on('bet', betListener);
    return () => {
      TexasHoldem.listener.off('bet', betListener);
    };
  }, [updateActionByWhom]);

  useEffect(() => {
    const foldListener = (round: number, who: string) => {
      updateActionByWhom(round, who, 'fold');
    };
    TexasHoldem.listener.on('fold', foldListener);
    return () => {
      TexasHoldem.listener.off('fold', foldListener);
    };
  }, [updateActionByWhom]);

  useEffect(() => {
    const allSetListener = (round: number) => {
      setActionsPerRound(prev => {
        const next = new Map(prev);
        const actions = next.get(round);
        if (!actions) {
          return prev;
        }
        for (let [player, action] of Array.from(actions.entries())) {
          if (typeof action !== 'string') {
            actions.delete(player); // cleanup bet actions
          }
        }
        return next;
      });
    };
    TexasHoldem.listener.on('allSet', allSetListener);
    return () => {
      TexasHoldem.listener.off('allSet', allSetListener);
    };
  }, []);

  useEffect(() => {
    const winnerListener = () => {
      setActionsPerRound(new Map());
    };
    TexasHoldem.listener.on('winner', winnerListener);
    return () => {
      TexasHoldem.listener.off('winner', winnerListener);
    };
  }, []);

  return useMemo(() => {
    if (!round) {
      return null;
    }
    const actions = actionsPerRound.get(round);
    if (!actions) {
      return null;
    }
    return new Map<string, string | number>(Array.from(actions.entries()).map(([k, v]) => {
      if (typeof v === 'string') {
        return [k, v];
      }
      const uidSeen = new Set<string>();
      const deduplicatedBetAmount = v.map(bet => {
        if (uidSeen.has(bet.uid)) {
          return 0;
        }
        uidSeen.add(bet.uid);
        return bet.bet;
      }).reduce((a, b) => a + b, 0);
      return [k, deduplicatedBetAmount || 'check'];
    }));
  }, [round, actionsPerRound]);
}

function useMyBetAmount(round: number | undefined, myPlayerId: string | undefined) {
  const [myBetAmountPerRound, setMyBetAmountPerRound] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    const betListener = (round: number, amount: number, who: string) => {
      if (who === myPlayerId) {
        setMyBetAmountPerRound(prev => {
          const next = new Map(prev);
          next.set(round, (next.get(round) ?? 0) + amount);
          return next;
        })
      }
    };
    TexasHoldem.listener.on('bet', betListener);
    return () => {
      TexasHoldem.listener.off('bet', betListener);
    };
  }, [myPlayerId]);

  return useMemo(() => round ? myBetAmountPerRound.get(round) : undefined, [myBetAmountPerRound, round]);
}

function useShowdownAndWinner(round: number | undefined) {
  const initialWinners = TexasHoldem.getStateSnapshot().winnersByRound;
  const [winnersByRound, setWinnersByRound] = useState<Map<number, WinningResult>>(() => new Map(initialWinners));
  const [lastWinningResult, setLastWinningResult] = useState<WinningResult | undefined>(() => {
    if (!initialWinners.size) {
      return undefined;
    }
    return Array.from(initialWinners.entries()).sort(([r1], [r2]) => r2 - r1)[0][1];
  });
  const [finishedPerRound, setFinishedPerRound] = useState<Map<number, true>>(() => (
    new Map(Array.from(initialWinners.keys()).map(finishedRound => [finishedRound, true]))
  ));
  useEffect(() => {
    const winnerListener = (result: WinningResult) => {
      setLastWinningResult(result);
      setWinnersByRound(prev => {
        const next = new Map(prev);
        next.set(result.round, result);
        return next;
      });
      setFinishedPerRound(prev => {
        const next = new Map(prev);
        next.set(result.round, true);
        return next;
      });
    };
    TexasHoldem.listener.on('winner', winnerListener);
    return () => {
      TexasHoldem.listener.off('winner', winnerListener);
    };
  }, []);
  const currentRoundFinished = useMemo(() => round ? (finishedPerRound.get(round) ?? false) : true,
    [finishedPerRound, round]);
  return {
    lastWinningResult,
    currentRoundFinished,
    winnersByRound,
  };
}

function useTranscript() {
  const [transcript, setTranscript] = useState<TranscriptSnapshot<TexasHoldemTableEvent> | null>(
    () => TexasHoldem.getTranscript?.() ?? null,
  );

  useEffect(() => {
    const transcriptListener = () => {
      setTranscript(TexasHoldem.getTranscript?.() ?? null);
    };
    TexasHoldem.listener.on('transcript', transcriptListener);
    transcriptListener();
    return () => {
      TexasHoldem.listener.off('transcript', transcriptListener);
    };
  }, []);

  return transcript;
}

function useRoundSettings(round: number | undefined) {
  const [settingsPerRound, setSettingsPerRound] = useState<Map<number, TexasHoldemRoundSettings>>(() => TexasHoldem.getStateSnapshot().settingsByRound);
  const [pendingSettings, setPendingSettings] = useState<TexasHoldemRoundSettings | undefined>(
    () => TexasHoldem.getStateSnapshot().pendingRoundSettings,
  );

  useEffect(() => {
    const roundSettingsListener: TexasHoldemGameRoomEvents['roundSettings'] = (round, settings) => {
      setSettingsPerRound(prev => {
        const next = new Map(prev);
        next.set(round, settings);
        return next;
      });
    };
    const pendingRoundSettingsListener: TexasHoldemGameRoomEvents['pendingRoundSettings'] = (settings) => {
      setPendingSettings(settings);
    };
    TexasHoldem.listener.on('roundSettings', roundSettingsListener);
    TexasHoldem.listener.on('pendingRoundSettings', pendingRoundSettingsListener);
    return () => {
      TexasHoldem.listener.off('roundSettings', roundSettingsListener);
      TexasHoldem.listener.off('pendingRoundSettings', pendingRoundSettingsListener);
    };
  }, []);

  return useMemo(() => round ? settingsPerRound.get(round) : pendingSettings, [pendingSettings, round, settingsPerRound]);
}

function useHandPause(round: number | undefined) {
  const [pauseByRound, setPauseByRound] = useState<Map<number, HandPauseState>>(
    () => TexasHoldem.getStateSnapshot().handPauseByRound,
  );
  useEffect(() => {
    const pauseListener: TexasHoldemGameRoomEvents['handPause'] = (state) => {
      setPauseByRound(prev => {
        const next = new Map(prev);
        if (state) {
          next.set(state.round, state);
        } else if (round) {
          next.delete(round);
        }
        return next;
      });
    };
    TexasHoldem.listener.on('handPause', pauseListener);
    return () => {
      TexasHoldem.listener.off('handPause', pauseListener);
    };
  }, [round]);

  return useMemo(() => round ? pauseByRound.get(round) ?? null : null, [pauseByRound, round]);
}

function getSeriesProgress(round: number | undefined, settings: TexasHoldemRoundSettings | undefined) {
  const total = settings?.plannedRounds ?? DEFAULT_PLANNED_ROUNDS;
  const start = settings?.seriesStartRound ?? round ?? 1;
  const current = round ? Math.max(1, round - start + 1) : 0;
  return {
    current: Math.min(current, total),
    total,
    complete: Boolean(round && current >= total),
  };
}

export default function useTexasHoldem() {
  const myPlayerId = useMyPlayerId();
  const status = useStatus();
  const {
    members,
    players,
    smallBlind,
    bigBlind,
    button,
    currentRound,
    playersByRound,
  } = useGameSetup();

  const bankrollsFromEngine = useBankrolls();

  const {
    scoreBoard: scoreBoardFromEngine,
    handScoreBoard,
    totalDebt,
  } = useScoreBoard();

  const {
    board,
    boardPerRound,
  } = useBoard(currentRound);

  const {
    myHole,
    holesPerPlayer,
    holesPerPlayerPerRound,
  } = useHoles(currentRound, myPlayerId);

  const whoseTurnFromEvents = useWhoseTurnAndCallAmount(currentRound);

  const fireBet = useCallback(async (amount: number) => {
    if (!currentRound) {
      return;
    }
    await TexasHoldem.bet(currentRound, amount);
  }, [currentRound]);

  const fireFold = useCallback(async () => {
    if (!currentRound) {
      return;
    }
    await TexasHoldem.fold(currentRound);
  }, [currentRound]);

  const sitOut = useCallback(async (roundOverride?: number | null) => {
    const targetRound = roundOverride !== undefined
      ? roundOverride
      : currentRound ?? TexasHoldem.getStateSnapshot().currentRound ?? null;
    await TexasHoldem.sitOut(targetRound);
  }, [currentRound]);

  const returnToTable = useCallback(async (roundOverride?: number | null) => {
    const targetRound = roundOverride !== undefined
      ? roundOverride
      : currentRound ?? TexasHoldem.getStateSnapshot().currentRound;
    await TexasHoldem.returnToTable(targetRound);
  }, [currentRound]);
  // Rejoin a table after a reconnect/refresh/reopen. The engine decides per the
  // returning client's own keys: resume if it can still decrypt the live hand,
  // otherwise declare the hand unfinishable so the whole table voids cleanly.
  // `wasDealtIntoHand` tells it whether this client is one of the live hand's
  // players (a pure spectator never triggers a void).
  const rejoinActiveHand = useCallback(async (roundOverride: number | null | undefined, wasDealtIntoHand: boolean) => {
    const targetRound = roundOverride !== undefined
      ? roundOverride
      : currentRound ?? TexasHoldem.getStateSnapshot().currentRound ?? null;
    await TexasHoldem.rejoinActiveHand(targetRound, wasDealtIntoHand);
  }, [currentRound]);
  const openRegistration = useCallback(async () => {
    await TexasHoldem.openRegistration(currentRound ?? TexasHoldem.getStateSnapshot().currentRound ?? null);
  }, [currentRound]);

  const takeSeat = useCallback(async (seat: number) => {
    await TexasHoldem.takeSeat(seat);
  }, []);

  const actionsDoneFromEvents = useActionsDone(currentRound);

  const potAmountFromEvents = usePotAmount();
  const myBetAmount = useMyBetAmount(currentRound, myPlayerId);
  const roundSettings = useRoundSettings(currentRound);
  const handPause = useHandPause(currentRound);

  const startNewRound = useCallback(async (settings?: Partial<TexasHoldemRoundSettings>) => {
    await TexasHoldem.startNewRound({
      bits: settings?.bits ?? DEFAULT_ENCRYPTION_BITS,
      initialFundAmount: settings?.initialFundAmount ?? 100,
      smallBlindAmount: settings?.smallBlindAmount ?? DEFAULT_SMALL_BLIND_AMOUNT,
      bigBlindAmount: settings?.bigBlindAmount ?? DEFAULT_BIG_BLIND_AMOUNT,
      autoFoldTimeoutSeconds: settings?.autoFoldTimeoutSeconds ?? DEFAULT_AUTO_FOLD_TIMEOUT_SECONDS,
      plannedRounds: settings?.plannedRounds ?? DEFAULT_PLANNED_ROUNDS,
      seriesStartRound: settings?.seriesStartRound,
      participants: settings?.participants,
    });
  }, []);
  const updateRoundSettings = useCallback(async (settings: TexasHoldemRoundSettings) => {
    await TexasHoldem.updateRoundSettings(settings);
  }, []);
  const canStartNewRound = useCallback(() => TexasHoldem.canStartNewRound(), []);
  const voteToVoidHand = useCallback(async (approve: boolean) => {
    if (!currentRound) {
      return;
    }
    await TexasHoldem.voteToVoidHand(currentRound, approve);
  }, [currentRound]);

  const {
    lastWinningResult,
    currentRoundFinished,
    winnersByRound,
  } = useShowdownAndWinner(currentRound);

  const transcript = useTranscript();

  // S4: persisted resolved-hand history (board + revealed holes), loaded once on mount so
  // it survives a refresh. Declared before the reducer so the reveal map can draw on it.
  const [persistedHistory] = useState<TexasHoldemRoundHistoryItem[]>(() => loadPersistedHistory(TableId));

  // Durable funds checkpoint loaded once on mount. Seeds the reducer so a refreshed/reopened
  // client carries the correct bankrolls into the live hand, even though the relay only
  // replays the current hand. Only applied when the local log is partial (does NOT start at
  // round 1) — a client that still holds the full history computes from scratch and never
  // depends on this stored value.
  const [loadedCheckpoint] = useState<FundsCheckpoint | undefined>(() => loadFundsCheckpoint(TableId));

  // Card reveals (board + showdown holes) the reducer needs to award showdown pots, so the
  // bankrolls it folds from the full transcript include winnings — not just blinds/bets.
  // Built from the live revealed cards AND the persisted history, so funds re-derive
  // correctly after a refresh (when the engine's incremental funds are stale). Fold-out
  // hands expose no holes and need none.
  const cardReveals = useMemo(() => {
    const rounds = new Set<number>([
      ...persistedHistory.map(h => h.round),
      ...Array.from(playersByRound.keys()),
      ...Array.from(boardPerRound.keys()),
      ...Array.from(holesPerPlayerPerRound.keys()),
    ]);
    const hands = Array.from(rounds).map(round => {
      const persisted = persistedHistory.find(h => h.round === round);
      const liveBoard = boardPerRound.get(round);
      const liveHoles = holesPerPlayerPerRound.get(round);
      return {
        round,
        players: playersByRound.get(round) ?? persisted?.players ?? [],
        board: (liveBoard && liveBoard.length ? liveBoard : persisted?.board) ?? [],
        holesPerPlayer: liveHoles ?? persisted?.holesPerPlayer,
      };
    });
    return cardRevealsFromHands(hands);
  }, [persistedHistory, playersByRound, boardPerRound, holesPerPlayerPerRound]);

  // Browser-authoritative state: derive the canonical betting view by folding the SAME
  // ordered signed log every client sees through the pure reducer. This is what makes a
  // reconnecting/refreshing client converge byte-identically with everyone else, instead
  // of each client's incrementally-mutated event state drifting (the mid-hand-refresh
  // desync). Gated on a real transcript being present, so the unit tests (which drive the
  // engine's emitted events directly, with no transcript) keep using the event path.
  // (BROWSER_AUTHORITATIVE_REWORK_PLAN.md S2.)
  const reducedTable = useMemo(() => {
    if (!transcript || transcript.entries.length === 0) {
      return null;
    }
    const events = transcriptToReducerEvents(transcript);
    if (events.length === 0) {
      return null;
    }
    // Apply the durable checkpoint ONLY when the local log is partial — i.e. it does not
    // contain round 1, so we genuinely lack the early history (a refresh/reopen where the
    // relay replayed just the current hand). A client that still holds round 1 has the full
    // log and recomputes from scratch, never trusting the stored snapshot.
    const hasGenesis = events.some(e => e.type === 'newRound' && e.round === 1);
    const checkpoint = !hasGenesis ? loadedCheckpoint : undefined;
    // `members` is the locally-reachable peer set (the mesh) — the browser's own view of
    // who is present, used for the seating/presence view (NOT the worker's online opinion).
    return reduceTexasHoldem(events, cardReveals, members, checkpoint);
  }, [transcript, members, cardReveals, loadedCheckpoint]);

  const reducedRound = useMemo(
    () => (reducedTable && currentRound != null ? reducedTable.rounds.get(currentRound) : undefined),
    [reducedTable, currentRound],
  );

  // Pot and whose-turn are the fields that visibly diverged across browsers; serve them
  // from the reducer when it owns the current round, else fall back to the event path.
  const potAmount = reducedRound
    ? Array.from(reducedRound.pot.values()).reduce((a, b) => a + b, 0)
    : potAmountFromEvents;
  const whoseTurnAndCallAmount = reducedRound
    ? (reducedRound.currentTurn
      ? { whoseTurn: reducedRound.currentTurn, callAmount: reducedRound.callAmount }
      : null)
    : whoseTurnFromEvents;
  // S2-rest: per-seat bet chips from the reducer (deterministic → converge across clients,
  // killing "bets vanish"), gated on the reducer owning the current round.
  const actionsDone = reducedRound
    ? reducedActionsByPlayer(reducedRound)
    : actionsDoneFromEvents;

  // Seat stacks come from the SAME reducer that owns pot/turn, fed with card reveals so
  // showdown winnings are included. This is the fix for "金额错乱 / 卡在 $0": the engine's
  // incrementally-mutated funds go stale after a refresh/reconnect (it only replays the
  // current-hand window), so a player could show $0 while the reducer still says it's their
  // turn — an unwinnable deadlock. Folding the full signed transcript makes funds converge
  // across clients and survive refresh, exactly like pot/turn already do. Falls back to the
  // engine's funds before any transcript exists (unit tests / first paint).
  const bankrolls = reducedTable ? reducedTable.funds : bankrollsFromEngine;

  // Session P&L shown in the chip overview, derived from the reducer as funds − boughtIn so
  // it ALWAYS balances to zero across players and never double-counts on a reconnect replay
  // (the old event-accumulated tally produced the alarming, unbalanced "-$200"). Falls back
  // to the engine tally before a transcript exists.
  const scoreBoard = useMemo(() => {
    if (!reducedTable) {
      return scoreBoardFromEngine;
    }
    const net = new Map<string, number>();
    for (const [player, fund] of Array.from(reducedTable.funds.entries())) {
      net.set(player, fund - (reducedTable.boughtIn.get(player) ?? 0));
    }
    return net;
  }, [reducedTable, scoreBoardFromEngine]);

  // Persist a fresh funds checkpoint between hands (no hand in progress ⇒ funds are clean,
  // post-resolution). This is what makes a future refresh/reopen carry correct bankrolls.
  // Only advances forward (never overwrites with an older round), and is best-effort.
  const lastSavedCheckpointRound = useRef<number>(loadedCheckpoint?.throughRound ?? 0);
  useEffect(() => {
    if (!reducedTable || reducedTable.handInProgress || reducedTable.resolvedRounds.length === 0) {
      return;
    }
    const throughRound = Math.max(...reducedTable.resolvedRounds);
    if (throughRound <= lastSavedCheckpointRound.current) {
      return;
    }
    lastSavedCheckpointRound.current = throughRound;
    saveFundsCheckpoint(TableId, {
      throughRound,
      funds: reducedTable.funds,
      boughtIn: reducedTable.boughtIn,
    });
  }, [reducedTable]);

  const roundHistory = useMemo<TexasHoldemRoundHistoryItem[]>(() => {
    const rounds = new Set<number>([
      ...Array.from(playersByRound.keys()),
      ...Array.from(boardPerRound.keys()),
      ...Array.from(holesPerPlayerPerRound.keys()),
      ...Array.from(winnersByRound.keys()),
    ]);
    if (currentRound) {
      rounds.add(currentRound);
    }

    return Array.from(rounds)
      .sort((a, b) => a - b)
      .map(roundNumber => ({
        round: roundNumber,
        players: playersByRound.get(roundNumber) ?? [],
        board: boardPerRound.get(roundNumber) ?? [],
        holesPerPlayer: holesPerPlayerPerRound.get(roundNumber),
        winningResult: winnersByRound.get(roundNumber),
      }));
  }, [boardPerRound, currentRound, holesPerPlayerPerRound, playersByRound, winnersByRound]);

  // S4: hydrate history from localStorage on mount (survives refresh), merge with the
  // live session (live wins per round, but a persisted result fills a not-yet-replayed
  // hand), and persist resolved hands back. (`persistedHistory` is declared above so the
  // reveal map can use it.)
  const mergedRoundHistory = useMemo<TexasHoldemRoundHistoryItem[]>(() => {
    const byRound = new Map<number, TexasHoldemRoundHistoryItem>();
    for (const item of persistedHistory) {
      byRound.set(item.round, item);
    }
    for (const item of roundHistory) {
      const existing = byRound.get(item.round);
      byRound.set(item.round, {
        ...existing,
        ...item,
        board: item.board.length ? item.board : (existing?.board ?? item.board),
        holesPerPlayer: item.holesPerPlayer ?? existing?.holesPerPlayer,
        winningResult: item.winningResult ?? existing?.winningResult,
      });
    }
    return Array.from(byRound.values()).sort((a, b) => a.round - b.round);
  }, [persistedHistory, roundHistory]);
  useEffect(() => {
    savePersistedHistory(TableId, mergedRoundHistory);
  }, [mergedRoundHistory]);

  const seriesProgress = useMemo(
    () => getSeriesProgress(currentRound, roundSettings),
    [currentRound, roundSettings],
  );

  return {
    peerState: status,
    playerId: myPlayerId,
    members,
    round: currentRound,
    currentRoundFinished,
    players,
    potAmount,
    hole: myHole,
    holesPerPlayer,
    board,
    whoseTurnAndCallAmount,
    smallBlind,
    bigBlind,
    button,
    startGame: startNewRound,
    bankrolls,
    scoreBoard,
    handScoreBoard,
    totalDebt,
    myBetAmount,
    lastWinningResult,
    roundHistory: mergedRoundHistory,
    transcript,
    actionsDone,
    roundSettings,
    handPause,
    seriesProgress,
    // The browser-authoritative reduced state (betting + seating) folded from the signed
    // log; null until a transcript exists. The table component reads seating/decisions
    // from here instead of the worker's roomState. (BROWSER_AUTHORITATIVE_REWORK_PLAN S3.)
    reduced: reducedTable,
    canStartGame: canStartNewRound,
    actions: {
      fireBet,
      fireFold,
      sitOut,
      returnToTable,
      rejoinActiveHand,
      openRegistration,
      voteToVoidHand,
      updateRoundSettings,
      takeSeat,
    },
  };
}
