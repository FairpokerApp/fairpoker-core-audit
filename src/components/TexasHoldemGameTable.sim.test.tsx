/**
 * REAL-ENGINE SIMULATION (not mocked game state).
 *
 * Goal: stop testing against hand-crafted assumptions. This renders the REAL
 * <TexasHoldemGameTable> wired to a REAL TexasHoldemGameRoom engine running a
 * real hand, and drives worker room-state through the REAL window event channel
 * (`fairpoker:room-state`) that the live app uses. The only doubles are the
 * in-memory transport (MockGameRoom) and the crypto layer (MockMentalPokerGameRoom),
 * which are orthogonal to the seating/lifecycle/shuffle UI bugs under test.
 *
 * Each `it` prints the player's on-screen text so we can SEE what a real player
 * would see at each step (evidence, not just a green/red dot).
 */
import React from 'react';
import {act, render, screen} from '@testing-library/react';
import EventEmitter from 'eventemitter3';
import Deferred from '../lib/Deferred';
import {GameEvent, GameRoomEvents} from '../lib/GameRoom';
import {MentalPokerGameRoomEvents, MentalPokerRoundSettings} from '../lib/MentalPokerGameRoom';
import {
  GameRoomLike,
  MentalPokerGameRoomLike,
  TexasHoldemGameRoom,
  TexasHoldemTableEvent,
} from '../lib/texas-holdem/TexasHoldemGameRoom';
import {WorkerRoomState, WorkerRoomPlayerState} from '../lib/CloudflareRelayTransport';
import {clearLatestWorkerRoomStatesForTest} from '../lib/useWorkerRoomState';

// ---- the "me" engine, exposed to the component via a mocked setup module ----
let mockTexasHoldem: TexasHoldemGameRoom;
// HostId is undefined for the TABLE HOST (setup.ts clears it when it equals your
// own peerId) and the host's peerId for GUESTS. Default to a guest-ish value so the
// existing tests keep their behavior; the restart tests set it explicitly.
let mockHostId: string | undefined = 'p1';
// Controllable REAL-shuffle status — the single source of truth for the overlay.
let mockShuffleStatus: {visible: boolean; startedAtMs: number | null; round: number | null; participants: string[]} = {
  visible: false, startedAtMs: null, round: null, participants: [],
};
jest.mock('../lib/setup', () => ({
  get TexasHoldem() {
    return mockTexasHoldem;
  },
  get HostId() {
    return mockHostId;
  },
  get TableId() {
    return 'table-test';
  },
  get peerId() {
    return 'p1';
  },
}));
jest.mock('../lib/useChatRoom', () => () => ({
  names: new Map([['p1', '我'], ['p2', '对手']]),
  setMyName: jest.fn(),
  messages: [],
  sendMessage: jest.fn(),
}));
jest.mock('../lib/texas-holdem/useEventLogs', () => () => []);
jest.mock('../lib/useEncryptedShuffleStatus', () => ({
  useEncryptedShuffleStatus: () => mockShuffleStatus,
}));

// Imported AFTER the mocks above are registered.
// eslint-disable-next-line import/first
import TexasHoldemGameTable from './TexasHoldemGameTable';

class MockGameRoom implements GameRoomLike<TexasHoldemTableEvent> {
  peerIdAsync: Promise<string>;
  peerIdDeferred = new Deferred<string>();
  eventsEmitted: Array<GameEvent<TexasHoldemTableEvent>> = [];
  listener = new EventEmitter<GameRoomEvents<GameEvent<TexasHoldemTableEvent>>>();
  private paired: Set<MockGameRoom> = new Set();

  constructor() {
    this.peerIdAsync = this.peerIdDeferred.promise;
  }

  async emitEvent(e: GameEvent<TexasHoldemTableEvent>) {
    const myPeerId = await this.peerIdAsync;
    this.eventsEmitted.push(e);
    this.listener.emit('event', e, myPeerId);
    for (const eachPaired of Array.from(this.paired)) {
      if (e.type === 'public' || e.recipient === await eachPaired.peerIdAsync) {
        eachPaired.listener.emit('event', e, myPeerId);
      }
    }
  }

  pair(another: MockGameRoom) {
    if (this === another) {
      return;
    }
    this.paired.add(another);
    another.paired.add(this);
  }
}

class MockMentalPokerGameRoom implements MentalPokerGameRoomLike {
  round = 0;
  listener = new EventEmitter<MentalPokerGameRoomEvents>();
  members: string[] = [];
  peerId?: string;

  async startNewRound(settings: MentalPokerRoundSettings) {
    const round = ++this.round;
    setTimeout(() => this.listener.emit('shuffled'), 0);
    return round;
  }

  async showCard(): Promise<void> {}
  async dealCard(): Promise<void> {}
}

function player(overrides: Partial<WorkerRoomPlayerState> & {peerId: string}): WorkerRoomPlayerState {
  return {
    online: true,
    connected: true,
    seated: true,
    status: 'active',
    ...overrides,
  } as WorkerRoomPlayerState;
}

let roomStateSeq = 1;
function pushWorkerRoomState(overrides: Partial<WorkerRoomState> = {}) {
  const roomState: WorkerRoomState = {
    version: roomStateSeq,
    source: 'cloudflare-worker',
    roomId: 'table-test',
    generatedAt: Date.now() + roomStateSeq,
    viewerPeerId: 'p1',
    latestEventSeq: roomStateSeq,
    currentRound: 1,
    currentPlayers: ['p1', 'p2'],
    currentTurn: null,
    players: [player({peerId: 'p1'}), player({peerId: 'p2'})],
    activePlayerCount: 2,
    onlineCount: 2,
    roomValid: true,
    playable: true,
    reason: 'ready',
    ...overrides,
  };
  roomStateSeq += 1;
  act(() => {
    window.dispatchEvent(new CustomEvent('fairpoker:room-state', {detail: {roomState}}));
  });
  return roomState;
}

async function buildEngineWithLiveHand() {
  const gameRoom = new MockGameRoom();
  gameRoom.peerIdDeferred.resolve('p1');
  const mentalPoker = new MockMentalPokerGameRoom();
  mentalPoker.peerId = 'p1';
  mentalPoker.members = ['p1', 'p2'];
  const engine = new TexasHoldemGameRoom(gameRoom, mentalPoker);
  // Start a real hand so the client engine authoritatively knows "I am a player
  // in a live, unfinished hand".
  await engine.startNewRound({initialFundAmount: 100});
  await new Promise(resolve => setTimeout(resolve, 0));
  return engine;
}

function screenText() {
  return document.body.textContent ?? '';
}

beforeEach(() => {
  roomStateSeq = 1;
  mockHostId = 'p1';
  mockShuffleStatus = {visible: false, startedAtMs: null, round: null, participants: []};
  clearLatestWorkerRoomStatesForTest();
  (window as unknown as {__fairPokerLatestRoomStates?: unknown}).__fairPokerLatestRoomStates = undefined;
});

describe('REAL-ENGINE SIM — refresh re-seat (bug #1)', () => {
  it('engine reports a live hand and the player sees the table (baseline)', async () => {
    mockTexasHoldem = await buildEngineWithLiveHand();
    const snapshot = mockTexasHoldem.getStateSnapshot();
    // eslint-disable-next-line no-console
    console.log('[SIM] engine snapshot currentRound =', snapshot.currentRound,
      '| playersByRound =', JSON.stringify(Array.from(snapshot.playersByRound.entries())));

    render(<TexasHoldemGameTable />);
    pushWorkerRoomState(); // normal in-hand state
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // eslint-disable-next-line no-console
    console.log('[SIM] baseline screen (first 300 chars):', screenText().slice(0, 300));
    expect(mockTexasHoldem.peerId).toBe('p1');
  });

  it('REPRO: a refresh blip (worker says offline) wrongly yanks me out of my own live hand', async () => {
    mockTexasHoldem = await buildEngineWithLiveHand();
    render(<TexasHoldemGameTable />);
    pushWorkerRoomState(); // I'm seated/active mid-hand
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    const beforeBlip = screen.queryByTestId('seat-recovery-panel');
    // eslint-disable-next-line no-console
    console.log('[SIM] before blip — seat-recovery-panel present?', Boolean(beforeBlip));

    // Simulate the refresh flicker: the worker momentarily reports me offline
    // before my socket re-announces. My engine STILL has me in the live hand.
    pushWorkerRoomState({
      players: [
        player({peerId: 'p1', online: false, connected: false, status: 'offline'}),
        player({peerId: 'p2'}),
      ],
      currentPlayers: ['p2'],
      activePlayerCount: 1,
      onlineCount: 1,
      playable: false,
      reason: 'waiting-for-seated-player',
    });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const panel = screen.queryByTestId('seat-recovery-panel');
    // eslint-disable-next-line no-console
    console.log('[SIM] after blip — seat-recovery-panel present?', Boolean(panel),
      '| text:', panel?.textContent ?? '(none)');

    // The panel must NOT appear — the browser is authoritative about its own
    // presence: I am mid-hand and did not choose to leave, so a stale worker
    // "offline" blip cannot pull me off the table.
    expect(panel).toBeNull();
  });

  it('COUNTER-CHECK: a genuine never-played spectator still gets the sit-down panel (no over-suppression)', async () => {
    // Fresh engine: this client has NEVER played a hand here, so it is not an
    // "established player" and the worker's "watching" status IS authoritative.
    const gameRoom = new MockGameRoom();
    gameRoom.peerIdDeferred.resolve('p1');
    const mentalPoker = new MockMentalPokerGameRoom();
    mentalPoker.peerId = 'p1';
    mentalPoker.members = ['p1', 'p2'];
    mockTexasHoldem = new TexasHoldemGameRoom(gameRoom, mentalPoker);

    render(<TexasHoldemGameTable />);
    pushWorkerRoomState({
      currentRound: 1,
      currentPlayers: ['p2'],
      players: [
        player({peerId: 'p1', seated: true, status: 'watching'}),
        player({peerId: 'p2'}),
      ],
      activePlayerCount: 1,
      playable: false,
      reason: 'waiting-for-seated-player',
    });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    const panel = screen.queryByTestId('seat-recovery-panel');
    // eslint-disable-next-line no-console
    console.log('[SIM] never-played spectator — seat-recovery-panel present?', Boolean(panel));
    expect(panel).not.toBeNull();
  });
});

async function buildEngineAndFinishAHand() {
  const gameRoom = new MockGameRoom();
  gameRoom.peerIdDeferred.resolve('p1');
  const mentalPoker = new MockMentalPokerGameRoom();
  mentalPoker.peerId = 'p1';
  mentalPoker.members = ['p1', 'p2'];
  const engine = new TexasHoldemGameRoom(gameRoom, mentalPoker);
  await engine.startNewRound({initialFundAmount: 100, autoFoldTimeoutSeconds: 600});
  await new Promise(resolve => setTimeout(resolve, 0));
  // Heads-up: p1 is small blind and acts first preflop. p1 folds → p2 wins → the
  // hand ends and we land on the next-hand transition (p1 stays seated).
  await engine.fold(1);
  await new Promise(resolve => setTimeout(resolve, 0));
  return engine;
}

describe('REAL-ENGINE SIM — next-hand transition is never a silent jump (bug #2)', () => {
  it('after a hand ends, the result AND a next-hand countdown are clearly shown', async () => {
    mockTexasHoldem = await buildEngineAndFinishAHand();
    expect(mockTexasHoldem.getStateSnapshot().winnersByRound.get(1)?.how).toBe('LastOneWins');

    render(<TexasHoldemGameTable />);
    pushWorkerRoomState({currentRound: 1, currentPlayers: ['p1', 'p2'], playable: true});
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // The player can SEE what happened and that a next hand is coming — no silent deal.
    expect(screen.queryByTestId('next-hand-countdown')).not.toBeNull();
    expect(screen.queryByTestId('seat-recovery-panel')).toBeNull();
    expect(screenText()).toContain('赢下本局'); // settlement result is visible
  });

  it('FIXED (via #1): a refresh blip during the next-hand window does NOT hide the countdown / silently jump', async () => {
    mockTexasHoldem = await buildEngineAndFinishAHand();
    render(<TexasHoldemGameTable />);
    pushWorkerRoomState({currentRound: 1, currentPlayers: ['p1', 'p2'], playable: true});
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(screen.queryByTestId('next-hand-countdown')).not.toBeNull();

    // The refresh blip: worker briefly reports me offline between hands. Before the
    // #1 fix this raised the seat-recovery panel → suppressStaging → the countdown
    // vanished → the next hand dealt with no visible prompt ("莫名其妙就下一局").
    pushWorkerRoomState({
      currentRound: 1,
      currentPlayers: ['p2'],
      players: [
        player({peerId: 'p1', online: false, connected: false, status: 'offline'}),
        player({peerId: 'p2'}),
      ],
      activePlayerCount: 1,
      onlineCount: 1,
      playable: false,
      reason: 'waiting-for-seated-player',
    });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const countdown = screen.queryByTestId('next-hand-countdown');
    const panel = screen.queryByTestId('seat-recovery-panel');
    // eslint-disable-next-line no-console
    console.log('[SIM] next-hand blip — countdown present?', Boolean(countdown), '| seat-recovery present?', Boolean(panel));
    expect(panel).toBeNull();          // not yanked out
    expect(countdown).not.toBeNull();  // the prompt stays — no silent jump
  });
});

describe('REAL-ENGINE SIM — shuffle overlay follows the REAL shuffle only (bug #3)', () => {
  it('overlay is shown IF AND ONLY IF the real shuffle transcript says one is in progress', async () => {
    mockTexasHoldem = await buildEngineWithLiveHand();
    render(<TexasHoldemGameTable />);
    pushWorkerRoomState();
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });

    // No real shuffle in progress → no overlay (the old optimistic overlay is gone).
    // eslint-disable-next-line no-console
    console.log('[SIM] no real shuffle → overlay present?', Boolean(screen.queryByTestId('shuffle-overlay')));
    expect(screen.queryByTestId('shuffle-overlay')).toBeNull();

    // Real shuffle starts (transcript-derived) → overlay appears.
    mockShuffleStatus = {visible: true, startedAtMs: Date.now(), round: 1, participants: ['p1', 'p2']};
    pushWorkerRoomState(); // force a re-render
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    // eslint-disable-next-line no-console
    console.log('[SIM] real shuffle visible → overlay present?', Boolean(screen.queryByTestId('shuffle-overlay')));
    expect(screen.queryByTestId('shuffle-overlay')).not.toBeNull();

    // Real shuffle ends → overlay disappears (no stuck/leftover animation).
    mockShuffleStatus = {visible: false, startedAtMs: null, round: 1, participants: ['p1', 'p2']};
    pushWorkerRoomState();
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    // eslint-disable-next-line no-console
    console.log('[SIM] real shuffle ended → overlay present?', Boolean(screen.queryByTestId('shuffle-overlay')));
    expect(screen.queryByTestId('shuffle-overlay')).toBeNull();
  });

  it('REPRO-FIXED: the next-hand transition with no real shuffle shows NO spurious overlay', async () => {
    // Previously the next-hand auto-start fired an optimistic setShuffleOverlayStartedAt(Date.now())
    // even when no real shuffle had begun → the animation "randomly appeared". That source is gone.
    mockTexasHoldem = await buildEngineAndFinishAHand();
    render(<TexasHoldemGameTable />);
    pushWorkerRoomState({currentRound: 1, currentPlayers: ['p1', 'p2'], playable: true});
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });

    // mockShuffleStatus.visible is false (no real shuffle) → overlay must NOT show,
    // even though we're sitting in the next-hand transition.
    // eslint-disable-next-line no-console
    console.log('[SIM] next-hand transition, no real shuffle → overlay present?', Boolean(screen.queryByTestId('shuffle-overlay')));
    expect(screen.queryByTestId('shuffle-overlay')).toBeNull();
  });
});

// Complete a 1-hand series so the FINAL report (matchComplete) is shown.
async function buildEngineAndCompleteSeries() {
  const gameRoom = new MockGameRoom();
  gameRoom.peerIdDeferred.resolve('p1');
  const mentalPoker = new MockMentalPokerGameRoom();
  mentalPoker.peerId = 'p1';
  mentalPoker.members = ['p1', 'p2'];
  const engine = new TexasHoldemGameRoom(gameRoom, mentalPoker);
  // plannedRounds: 1 -> after the single hand finishes, the series is complete.
  await engine.startNewRound({initialFundAmount: 100, autoFoldTimeoutSeconds: 600, plannedRounds: 1});
  await new Promise(resolve => setTimeout(resolve, 0));
  await engine.fold(1); // p1 folds heads-up -> hand ends -> series complete
  await new Promise(resolve => setTimeout(resolve, 0));
  return engine;
}

describe('REAL-ENGINE SIM — restart match (bug)', () => {
  it('host sees the restart button on the final report', async () => {
    mockHostId = undefined; // p1 is the real table host
    mockTexasHoldem = await buildEngineAndCompleteSeries();
    const snap = mockTexasHoldem.getStateSnapshot();
    // eslint-disable-next-line no-console
    console.log('[SIM] series complete? round =', snap.currentRound,
      '| winner =', JSON.stringify(snap.winnersByRound.get(1)?.how));

    render(<TexasHoldemGameTable />);
    pushWorkerRoomState({currentRound: 1, currentPlayers: ['p1', 'p2'], playable: true});
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });

    const btn = screen.queryByTestId('score-board-new-table-button');
    // eslint-disable-next-line no-console
    console.log('[SIM] final-report restart button present?', Boolean(btn), '| text =', btn?.textContent);
    expect(btn).not.toBeNull();
  });

  it('REPRO: after host clicks restart, the table returns to a usable start lobby', async () => {
    mockHostId = undefined; // p1 is the real table host
    mockTexasHoldem = await buildEngineAndCompleteSeries();
    render(<TexasHoldemGameTable />);
    pushWorkerRoomState({currentRound: 1, currentPlayers: ['p1', 'p2'], playable: true});
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });

    const btn = screen.getByTestId('score-board-new-table-button');
    await act(async () => {
      btn.click();
      await new Promise(r => setTimeout(r, 0));
    });
    // The worker now reports registration open (currentRound = null), exactly as the
    // real relay does on action/openRegistration.
    pushWorkerRoomState({currentRound: null, currentPlayers: [], playable: false, reason: 'registration'});
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });

    // eslint-disable-next-line no-console
    console.log('[SIM] after restart — staging?', Boolean(screen.queryByTestId('staging')),
      '| start-button?', Boolean(screen.queryByTestId('start-button')),
      '| new-table-button?', Boolean(screen.queryByTestId('new-table-button')),
      '\n  text =', screenText().replace(/\s+/g, ' ').slice(0, 400));

    expect(screen.queryByTestId('start-button')).not.toBeNull();
  });

  it('REPRO (real bug): host clicks restart but the relay still reports the just-finished hand → host is NOT trapped on "牌局正在进行 / 回到桌上"', async () => {
    mockHostId = undefined; // p1 is the real table host
    mockTexasHoldem = await buildEngineAndCompleteSeries();
    render(<TexasHoldemGameTable />);
    // Relay still reports the finished hand as the "current round" — the openRegistration
    // event has not round-tripped through the relay yet (or the relay view is stale).
    pushWorkerRoomState({currentRound: 1, currentPlayers: ['p1', 'p2'], playable: true});
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });

    const btn = screen.getByTestId('score-board-new-table-button');
    await act(async () => {
      btn.click();
      await new Promise(r => setTimeout(r, 0));
    });
    // The relay is still lagging: it pushes another heartbeat with the SAME old round.
    pushWorkerRoomState({currentRound: 1, currentPlayers: ['p1', 'p2'], playable: true});
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });

    // eslint-disable-next-line no-console
    console.log('[SIM] restart w/ lagging relay — staging?', Boolean(screen.queryByTestId('staging')),
      '| start-button?', Boolean(screen.queryByTestId('start-button')),
      '| active-hand panel?', Boolean(screen.queryByTestId('staging-active-hand')),
      '\n  text =', screenText().replace(/\s+/g, ' ').slice(0, 300));

    // The host deliberately ended the series and opened registration. A stale relay
    // "live hand" signal must NOT trap them on "牌局正在进行 / 回到桌上" with no way to start.
    expect(screen.queryByTestId('staging-active-hand')).toBeNull();
    expect(screen.queryByTestId('start-button')).not.toBeNull();
  });
});

// Build engine where p1 has PLAYED and finished a hand (so p1 is an established
// player of this table), exposing the gameRoom so the test can read what actions
// the engine emits when the user clicks a button.
async function buildEstablishedEngineExposed() {
  const gameRoom = new MockGameRoom();
  gameRoom.peerIdDeferred.resolve('p1');
  const mentalPoker = new MockMentalPokerGameRoom();
  mentalPoker.peerId = 'p1';
  mentalPoker.members = ['p1', 'p2'];
  const engine = new TexasHoldemGameRoom(gameRoom, mentalPoker);
  await engine.startNewRound({initialFundAmount: 100, autoFoldTimeoutSeconds: 600});
  await new Promise(resolve => setTimeout(resolve, 0));
  await engine.fold(1); // p1 folds heads-up -> hand 1 ends, p1 stays an established player
  await new Promise(resolve => setTimeout(resolve, 0));
  return {engine, gameRoom};
}

function emittedTypes(gameRoom: MockGameRoom) {
  return gameRoom.eventsEmitted
    .map(e => (e as {data?: {type?: string}}).data?.type)
    .filter(Boolean);
}

describe('REAL-ENGINE SIM — stand up then sit back down (single-client guard)', () => {
  it('after standing up (sitOut), clicking 回到桌上 emits returnToTable and clears the panel once the relay reports me seated', async () => {
    mockHostId = undefined; // p1 is the real table host
    const {engine, gameRoom} = await buildEstablishedEngineExposed();
    mockTexasHoldem = engine;
    render(<TexasHoldemGameTable />);

    // The relay reports p1 as having stood up (sittingOut) between hands.
    pushWorkerRoomState({
      currentRound: 1,
      currentPlayers: ['p1', 'p2'],
      players: [
        player({peerId: 'p1', seated: false, status: 'sittingOut'}),
        player({peerId: 'p2'}),
      ],
      activePlayerCount: 1,
      onlineCount: 2,
      playable: false,
      reason: 'waiting-for-seated-player',
    });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });

    const panel = screen.queryByTestId('seat-recovery-panel');
    const btn = screen.queryByTestId('return-to-table-button');
    // eslint-disable-next-line no-console
    console.log('[SIM] stood up — panel?', Boolean(panel), '| return button?', Boolean(btn),
      '\n  text =', screenText().replace(/\s+/g, ' ').slice(0, 160));
    expect(panel).not.toBeNull();
    expect(btn).not.toBeNull();

    gameRoom.eventsEmitted.length = 0; // only watch what the click emits
    await act(async () => {
      btn!.click();
      await new Promise(r => setTimeout(r, 0));
    });
    // eslint-disable-next-line no-console
    console.log('[SIM] click 回到桌上 emitted:', JSON.stringify(emittedTypes(gameRoom)));
    expect(emittedTypes(gameRoom)).toContain('action/returnToTable');

    // The relay now reports p1 back as active/seated (what the real worker produces
    // on action/returnToTable — verified separately at the worker level).
    pushWorkerRoomState({
      currentRound: 1,
      currentPlayers: ['p1', 'p2'],
      players: [player({peerId: 'p1'}), player({peerId: 'p2'})],
      activePlayerCount: 2,
      onlineCount: 2,
      playable: true,
      reason: 'ready',
    });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });

    const panelAfter = screen.queryByTestId('seat-recovery-panel');
    // eslint-disable-next-line no-console
    console.log('[SIM] after return — panel still present?', Boolean(panelAfter));
    expect(panelAfter).toBeNull(); // the player is back; no "你已暂离牌桌" trap
  });
});

describe('REAL-ENGINE SIM — stand up while a new hand is live (single-client guard)', () => {
  it('stood up, a new hand (round 2) is already dealing WITHOUT me; clicking 回到桌上 leaves me on a clear "next hand" state, not a dead 你已暂离 trap', async () => {
    mockHostId = undefined;
    const {engine, gameRoom} = await buildEstablishedEngineExposed();
    mockTexasHoldem = engine; // local engine: round 1 finished
    render(<TexasHoldemGameTable />);

    // Worker is AHEAD: a new hand (round 2) is live with only p2; I (p1) stood up and
    // am sittingOut, not in this hand.
    pushWorkerRoomState({
      currentRound: 2,
      currentPlayers: ['p2'],
      players: [
        player({peerId: 'p1', seated: false, status: 'sittingOut'}),
        player({peerId: 'p2'}),
      ],
      activePlayerCount: 1,
      onlineCount: 2,
      playable: false,
      reason: 'waiting-for-seated-player',
    });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });

    const btn = screen.queryByTestId('return-to-table-button');
    // eslint-disable-next-line no-console
    console.log('[SIM] new-hand-live, stood up — return button?', Boolean(btn),
      '\n  text =', screenText().replace(/\s+/g, ' ').slice(0, 180));
    expect(btn).not.toBeNull();

    gameRoom.eventsEmitted.length = 0;
    await act(async () => { btn!.click(); await new Promise(r => setTimeout(r, 0)); });
    // eslint-disable-next-line no-console
    console.log('[SIM] click emitted:', JSON.stringify(emittedTypes(gameRoom)));

    // Worker after returnToTable: I'm seated/active again but NOT in the live hand
    // (queued for the next one), round 2 still running with p2.
    pushWorkerRoomState({
      currentRound: 2,
      currentPlayers: ['p2'],
      players: [player({peerId: 'p1'}), player({peerId: 'p2'})],
      activePlayerCount: 2,
      onlineCount: 2,
      playable: true,
      reason: 'ready',
    });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });

    const panelAfter = screen.queryByTestId('seat-recovery-panel');
    // eslint-disable-next-line no-console
    console.log('[SIM] after return (hand still live w/o me) — 你已暂离 panel?', Boolean(panelAfter),
      '\n  text =', screenText().replace(/\s+/g, ' ').slice(0, 220));
    expect(panelAfter).toBeNull();
  });
});

describe('REAL-ENGINE SIM — 回到桌上 recovers via page reload (livelock workaround)', () => {
  it('clicking 回到桌上 emits returnToTable AND reloads the page (the reliable recovery)', async () => {
    mockHostId = undefined;
    const {engine, gameRoom} = await buildEstablishedEngineExposed();
    mockTexasHoldem = engine;

    const reloadSpy = jest.fn();
    // jsdom's location.reload is non-configurable, so swap the whole location object.
    const originalLocation = window.location;
    const fakeLocation = {
      href: originalLocation.href,
      search: originalLocation.search,
      hostname: originalLocation.hostname,
      pathname: originalLocation.pathname,
      origin: originalLocation.origin,
      reload: reloadSpy,
      assign: jest.fn(),
      replace: jest.fn(),
    };
    Object.defineProperty(window, 'location', {configurable: true, writable: true, value: fakeLocation});

    try {
      render(<TexasHoldemGameTable />);
      pushWorkerRoomState({
        currentRound: 1,
        currentPlayers: ['p1', 'p2'],
        players: [
          player({peerId: 'p1', seated: false, status: 'sittingOut'}),
          player({peerId: 'p2'}),
        ],
        activePlayerCount: 1,
        onlineCount: 2,
        playable: false,
        reason: 'waiting-for-seated-player',
      });
      await act(async () => { await new Promise(r => setTimeout(r, 0)); });

      const btn = screen.getByTestId('return-to-table-button');
      gameRoom.eventsEmitted.length = 0;
      await act(async () => {
        btn.click();
        await new Promise(r => setTimeout(r, 600)); // past RETURN_TO_TABLE_RELOAD_DELAY_MS
      });

      // eslint-disable-next-line no-console
      console.log('[SIM] 回到桌上 emitted:', JSON.stringify(emittedTypes(gameRoom)),
        '| reload called?', reloadSpy.mock.calls.length > 0);
      expect(emittedTypes(gameRoom)).toContain('action/returnToTable');
      expect(reloadSpy).toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', {configurable: true, writable: true, value: originalLocation});
    }
  });
});
