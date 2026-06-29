import EventEmitter from "eventemitter3";

const emitter = new EventEmitter();

const stubListener = {
  on: emitter.on.bind(emitter),
  off: emitter.off.bind(emitter),
  once: emitter.once.bind(emitter),
};

const stubGameRoom = {
  listener: stubListener,
  peerIdAsync: Promise.resolve('mock-peer-id'),
  emitEvent: () => Promise.resolve(),
  close: () => {},
};

export const HostId = undefined;
export const TableId = 'table-test';

export const TexasHoldem = {
  listener: stubListener,
  gameRoom: stubGameRoom,
  bet: () => Promise.resolve(),
  fold: () => Promise.resolve(),
  sitOut: () => Promise.resolve(),
  returnToTable: () => Promise.resolve(),
  openRegistration: () => Promise.resolve(),
  voteToVoidHand: () => Promise.resolve(),
  startNewRound: () => Promise.resolve(),
  canStartNewRound: () => true,
  getStateSnapshot: () => ({
    currentRound: undefined,
    playersByRound: new Map(),
    boardByRound: new Map(),
    holesByRound: new Map(),
    whoseTurnByRound: new Map(),
    potAmount: 0,
    winnersByRound: new Map(),
    handPauseByRound: new Map(),
    settingsByRound: new Map(),
    bankrolls: new Map(),
  }),
  close: () => {},
};

export const Chat = {
  listener: stubListener,
  announceClientVersion: () => Promise.resolve(),
  close: () => {},
};

export const setupReady = Promise.resolve({
  HostId,
  TableId,
  TexasHoldem,
  Chat,
});

export const ensureSetupReady = () => setupReady;

export const isSetupReady = () => true;
