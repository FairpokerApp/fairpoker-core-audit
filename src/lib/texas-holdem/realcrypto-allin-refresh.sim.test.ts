// REAL-CRYPTO guardian harness for the live STUCK bug (all-in + refresh → board never runs
// out). Every earlier sim used a MOCK deck (plaintext cards, no keys) so it was blind to the
// reveal/key layer. This drives TWO real TexasHoldemGameRoom engines, each over a REAL
// MentalPokerGameRoom (real SRA shuffle/lock/decrypt + localStorage key persistence), through
// a heads-up all-in, then REFRESHES one peer (new MentalPokerGameRoom with the SAME storage
// scope reloads its persisted keys; new engine replays the current-hand window) and asserts
// the all-in board still RUNS OUT and the showdown resolves on both sides.
//
// Milestone 1 (this file first proves the harness): two peers shuffle + deal real hole cards.

import { GameRoomEvents, GameEvent } from "../GameRoom";
import MentalPokerGameRoom, { GameRoomLike, MentalPokerEvent } from "../MentalPokerGameRoom";
import { TexasHoldemGameRoom, TexasHoldemTableEvent } from "./TexasHoldemGameRoom";
import Deferred from "../Deferred";
import EventEmitter from "eventemitter3";

type AnyEvent = TexasHoldemTableEvent | MentalPokerEvent;

async function generateRsaPair() {
  return window.crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt'],
  );
}

// Paired transport carrying BOTH texas + mental-poker events between two peers. Records the
// public table-event stream so a "refresh" can replay the current hand's window.
class PairedRoom implements GameRoomLike<AnyEvent> {
  listener = new EventEmitter<GameRoomEvents<GameEvent<AnyEvent>>>();
  peerIdAsync: Promise<string>;
  peerIdDeferred = new Deferred<string>();
  peerId?: string;
  members: string[] = [];
  // Mirrors the real GameRoom field the Texas engine reads to key its funds-checkpoint.
  // Left undefined for the existing milestones (so restoreFundsFromCheckpoint is a no-op);
  // set only by the navigate-away milestone that exercises the checkpoint + wide replay.
  expectedTableId?: string;
  publicLog: GameEvent<AnyEvent>[] = [];
  sharedLog: GameEvent<AnyEvent>[]; // globally-ordered public stream (the relay's view)
  closed = false;
  private paired: Set<PairedRoom> = new Set();
  constructor(sharedLog?: GameEvent<AnyEvent>[]) {
    this.sharedLog = sharedLog ?? [];
    this.peerIdAsync = this.peerIdDeferred.promise;
    void this.peerIdAsync.then(id => { this.peerId = id; });
  }
  async emitEvent(e: GameEvent<AnyEvent>) {
    const myId = await this.peerIdAsync;
    if (e.type === 'public') { this.publicLog.push(e); this.sharedLog.push(e); }
    this.listener.emit('event', e, myId, false);
    for (const peer of Array.from(this.paired)) {
      if (peer.closed) continue; // a refreshed-away peer's old socket no longer receives
      if (e.type === 'public' || (e as any).recipient === await peer.peerIdAsync) {
        peer.listener.emit('event', e, myId, false);
      }
    }
  }
  pair(other: PairedRoom) { this.paired.add(other); other.paired.add(this); }
  connect() {}
  close() { this.closed = true; }
}

const flush = () => new Promise<void>(r => setTimeout(r, 0));
async function waitFor(cond: () => boolean, label: string, timeoutMs = 60000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for: ${label}`);
    await flush();
  }
}

async function makePeer(id: string, scope: string, sharedLog?: GameEvent<AnyEvent>[], rsaPair?: CryptoKeyPair, tableId?: string) {
  const room = new PairedRoom(sharedLog);
  room.peerIdDeferred.resolve(id);
  // Set BEFORE constructing the engine: its constructor runs restoreFundsFromCheckpoint(),
  // which reads expectedTableId off the room to find the localStorage checkpoint.
  room.expectedTableId = tableId;
  const pair = rsaPair ?? await generateRsaPair();
  const jwk = await window.crypto.subtle.exportKey('jwk', pair.publicKey);
  const mp = new MentalPokerGameRoom(room as any, scope, { privateKey: pair.privateKey, publicKeyJwk: jwk });
  const engine = new TexasHoldemGameRoom(room as any, mp as any);
  return { id, room, mp, engine, rsaPair: pair };
}

type Peer = Awaited<ReturnType<typeof makePeer>>;

// The current hand's replayable window = everything from the latest mental-poker `start`
// event (the relay FIX anchors reconnect replay here so the deck is always re-sent).
function currentHandWindow(shared: GameEvent<AnyEvent>[]): GameEvent<AnyEvent>[] {
  let startIdx = 0;
  for (let i = shared.length - 1; i >= 0; i--) {
    if ((shared[i].data as any)?.type === 'start') { startIdx = i; break; }
  }
  return shared.slice(startIdx);
}

// Simulate a browser refresh / close-and-return of `old`: drop its in-memory state, rebuild
// with the SAME storage scope (reloads persisted per-card keys) and the SAME RSA identity,
// replay the current-hand window (the relay FIX), re-pair to the partner, and rejoin.
async function refreshPeer(old: Peer, scope: string, shared: GameEvent<AnyEvent>[], partner: Peer, members: string[], round: number, replayWindow = true) {
  old.engine.close();
  old.room.close();
  const fresh = await makePeer(old.id, scope, shared, old.rsaPair);
  fresh.room.members = members;
  fresh.room.pair(partner.room);
  if (replayWindow) {
    for (const e of currentHandWindow(shared)) fresh.room.listener.emit('event', e, (e as any).sender, true);
  }
  for (let i = 0; i < 30; i++) await flush();
  await fresh.engine.returnToTable(round);
  for (let i = 0; i < 12; i++) await flush();
  return fresh;
}

// Drive betting: whoever's turn it is (per `view`'s snapshot) takes `decide` (>=0 bet, <0 fold)
// from the matching engine, until the hand resolves or `maxSteps`.
async function driveBetting(peersById: Record<string, Peer>, view: Peer, round: number, decide: (who: string, fund: number, call: number) => number, maxSteps = 40) {
  for (let step = 0; step < maxSteps; step++) {
    await flush();
    const snap = view.engine.getStateSnapshot();
    if (snap.winnersByRound.get(round)) break;
    const turn = snap.whoseTurnByRound.get(round);
    if (!turn || !turn.whoseTurn) { await flush(); continue; }
    const who = turn.whoseTurn;
    const p = peersById[who];
    if (!p) { await flush(); continue; }
    const fund = p.engine.getStateSnapshot().bankrolls.get(who) ?? 0;
    const call = Math.max(0, turn.callAmount ?? 0);
    const amt = decide(who, fund, call);
    if (amt < 0) await p.engine.fold(round);
    else await p.engine.bet(round, Math.min(fund, amt));
    await flush();
  }
}

describe('real-crypto all-in refresh', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  test('MILESTONE 1: two real-crypto peers shuffle and deal hole cards', async () => {
    const a = await makePeer('A', 'room-A');
    const b = await makePeer('B', 'room-B');
    a.room.pair(b.room);
    a.room.members = ['A', 'B'];
    b.room.members = ['A', 'B'];

    await a.mp.announceEncryptionKey();
    await b.mp.announceEncryptionKey();
    // Let both encryption-key announcements fully propagate + be processed before any deal,
    // otherwise per-card keys get sealed to a not-yet-known RSA key (oaep decode error).
    for (let i = 0; i < 20; i++) await flush();

    await a.engine.startNewRound({ initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2, bits: 1024, participants: ['A', 'B'] });

    // A learns at least one of its hole cards through real shuffle + per-card decryption.
    await waitFor(() => (a.engine.getStateSnapshot().holesByRound.get(1)?.size ?? 0) > 0, 'A hole card', 90000);

    const snapA = a.engine.getStateSnapshot();
    expect(snapA.currentRound).toBe(1);
    const aHoles = snapA.holesByRound.get(1);
    expect(aHoles && aHoles.size).toBeGreaterThan(0);
    a.engine.close();
    b.engine.close();
  }, 120000);

  test('MILESTONE 2: a real-crypto all-in runs the board out and resolves the showdown', async () => {
    const a = await makePeer('A', 'room-A');
    const b = await makePeer('B', 'room-B');
    a.room.pair(b.room);
    a.room.members = ['A', 'B'];
    b.room.members = ['A', 'B'];
    await a.mp.announceEncryptionKey();
    await b.mp.announceEncryptionKey();
    for (let i = 0; i < 20; i++) await flush();

    await a.engine.startNewRound({ initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2, bits: 1024, participants: ['A', 'B'] });
    await waitFor(() => (a.engine.getStateSnapshot().holesByRound.get(1)?.size ?? 0) > 0, 'holes dealt', 90000);

    // Drive both players all-in: whoever's turn it is shoves their whole stack.
    const peers: Record<string, { engine: TexasHoldemGameRoom }> = { A: a, B: b };
    for (let step = 0; step < 40; step++) {
      await flush();
      const snap = a.engine.getStateSnapshot();
      if (snap.winnersByRound.get(1)) break;
      const turn = snap.whoseTurnByRound.get(1);
      if (!turn || !turn.whoseTurn) { await flush(); continue; }
      const who = turn.whoseTurn;
      const fund = peers[who].engine.getStateSnapshot().bankrolls.get(who) ?? 0;
      if (fund <= 0) { await flush(); continue; }
      await peers[who].engine.bet(1, fund);
    }

    // The board must run all the way out and BOTH engines must resolve the showdown.
    await waitFor(() => !!a.engine.getStateSnapshot().winnersByRound.get(1), 'A resolves showdown', 90000);
    await waitFor(() => !!b.engine.getStateSnapshot().winnersByRound.get(1), 'B resolves showdown', 90000);
    expect((a.engine.getStateSnapshot().boardByRound.get(1) ?? []).length).toBe(5);
    const f = a.engine.getStateSnapshot().bankrolls;
    expect((f.get('A') ?? 0) + (f.get('B') ?? 0)).toBe(200); // chips conserved
    a.engine.close();
    b.engine.close();
  }, 120000);

  test('MILESTONE 3 (REPRO): A all-in → A REFRESHES → B all-in → board must still run out', async () => {
    const shared: GameEvent<AnyEvent>[] = [];
    const a = await makePeer('A', 'room-A', shared);
    const b = await makePeer('B', 'room-B', shared);
    a.room.pair(b.room);
    a.room.members = ['A', 'B'];
    b.room.members = ['A', 'B'];
    await a.mp.announceEncryptionKey();
    await b.mp.announceEncryptionKey();
    for (let i = 0; i < 20; i++) await flush();

    await a.engine.startNewRound({ initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2, bits: 1024, participants: ['A', 'B'] });
    await waitFor(() => (a.engine.getStateSnapshot().holesByRound.get(1)?.size ?? 0) > 0, 'holes dealt', 90000);

    // A (first to act, heads-up) shoves all-in; stop BEFORE B acts.
    await waitFor(() => a.engine.getStateSnapshot().whoseTurnByRound.get(1)?.whoseTurn === 'A', 'A to act', 30000);
    await a.engine.bet(1, a.engine.getStateSnapshot().bankrolls.get('A') ?? 0);
    await waitFor(() => a.engine.getStateSnapshot().whoseTurnByRound.get(1)?.whoseTurn === 'B', 'B to act', 30000);

    // === REFRESH A: rebuild with the SAME storage scope (reloads persisted per-card keys)
    // and the SAME RSA identity; replay the recorded current-hand window into it. ===
    a.engine.close();
    const a2 = await makePeer('A', 'room-A', shared, a.rsaPair);
    a2.room.members = ['A', 'B'];
    a2.room.pair(b.room);
    for (const e of shared.slice()) {
      a2.room.listener.emit('event', e, (e as any).sender, true); // replay
    }
    for (let i = 0; i < 30; i++) await flush();
    // A announces it is back at the table.
    await a2.engine.returnToTable(1);
    for (let i = 0; i < 10; i++) await flush();

    // B calls all-in → both all-in → the board must run out and resolve on BOTH sides.
    await waitFor(() => b.engine.getStateSnapshot().whoseTurnByRound.get(1)?.whoseTurn === 'B', 'B to act after A return', 30000);
    await b.engine.bet(1, b.engine.getStateSnapshot().bankrolls.get('B') ?? 0);

    await waitFor(() => !!b.engine.getStateSnapshot().winnersByRound.get(1), 'B resolves', 60000);
    await waitFor(() => !!a2.engine.getStateSnapshot().winnersByRound.get(1), 'refreshed A resolves', 60000);
    expect((b.engine.getStateSnapshot().boardByRound.get(1) ?? []).length).toBe(5);
    a2.engine.close();
    b.engine.close();
  }, 120000);

  test('MILESTONE 4 (the BUG): OLD relay behavior — no full-hand replay on reconnect → STALL', async () => {
    // Same flow as milestone 3, but model the PRODUCTION relay's reconnect: it replays only
    // events AFTER the client's last-seen seq, which (for a refresh after one's own all-in)
    // is everything — so the rebuilt client receives NOTHING of the hand it was in (no deck,
    // no newRound). This is exactly the live stall. The relay FIX (selectReplayEntries
    // anchored at handStartSeq) is what turns this into milestone 3's success.
    const shared: GameEvent<AnyEvent>[] = [];
    const a = await makePeer('A', 'room-A', shared);
    const b = await makePeer('B', 'room-B', shared);
    a.room.pair(b.room);
    a.room.members = ['A', 'B'];
    b.room.members = ['A', 'B'];
    await a.mp.announceEncryptionKey();
    await b.mp.announceEncryptionKey();
    for (let i = 0; i < 20; i++) await flush();

    await a.engine.startNewRound({ initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2, bits: 1024, participants: ['A', 'B'] });
    await waitFor(() => (a.engine.getStateSnapshot().holesByRound.get(1)?.size ?? 0) > 0, 'holes dealt', 90000);
    await waitFor(() => a.engine.getStateSnapshot().whoseTurnByRound.get(1)?.whoseTurn === 'A', 'A to act', 30000);
    await a.engine.bet(1, a.engine.getStateSnapshot().bankrolls.get('A') ?? 0);
    await waitFor(() => a.engine.getStateSnapshot().whoseTurnByRound.get(1)?.whoseTurn === 'B', 'B to act', 30000);

    // REFRESH A with the OLD relay: replay NOTHING of the in-progress hand (sinceSeq is current).
    a.engine.close();
    const a2 = await makePeer('A', 'room-A', shared, a.rsaPair);
    a2.room.members = ['A', 'B'];
    a2.room.pair(b.room);
    // (no replay of `shared` — the production relay would not re-send what A already saw)
    for (let i = 0; i < 20; i++) await flush();
    await a2.engine.returnToTable(1);
    for (let i = 0; i < 10; i++) await flush();

    await waitFor(() => b.engine.getStateSnapshot().whoseTurnByRound.get(1)?.whoseTurn === 'B', 'B to act', 30000);
    await b.engine.bet(1, b.engine.getStateSnapshot().bankrolls.get('B') ?? 0);
    // Give it real time — then assert it is STILL stuck (no resolution), reproducing the live bug.
    for (let i = 0; i < 400; i++) await flush();
    expect(a2.engine.getStateSnapshot().winnersByRound.get(1)).toBeUndefined();
    expect((a2.engine.getStateSnapshot().boardByRound.get(1) ?? []).length).toBeLessThan(5);
    a2.engine.close();
    b.engine.close();
  }, 120000);

  // NOTE: this exercises a refresh where returnToTable races ahead of the replay and the
  // hand had already resolved live — the refreshed client catches up to the result via the
  // replayed reveals. It does NOT isolate the settle re-trigger (the board decrypts from the
  // replayed keys here); the intermittent live race (refreshed player must RE-PUBLISH its own
  // board keys while the opponent is paused) could not be reproduced deterministically in-sim.
  test('MILESTONE 5: a refresh whose returnToTable races the replay still catches up to the result', async () => {
    const shared: GameEvent<AnyEvent>[] = [];
    const a = await makePeer('A', 'room-A', shared);
    const b = await makePeer('B', 'room-B', shared);
    a.room.pair(b.room);
    a.room.members = ['A', 'B'];
    b.room.members = ['A', 'B'];
    await a.mp.announceEncryptionKey();
    await b.mp.announceEncryptionKey();
    for (let i = 0; i < 20; i++) await flush();

    await a.engine.startNewRound({ initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2, bits: 1024, participants: ['A', 'B'] });
    await waitFor(() => (a.engine.getStateSnapshot().holesByRound.get(1)?.size ?? 0) > 0, 'holes dealt', 90000);

    // BOTH all-in (so the hand reaches showdownReady; the board is what's left).
    await driveBetting({ A: a, B: b }, b, 1, (_who, fund) => fund);
    await waitFor(() => !!b.engine.getStateSnapshot().winnersByRound.get(1), 'B resolves (live)', 60000);

    // REFRESH A and RACE: fire returnToTable BEFORE replaying the hand window, so the one-shot
    // recovery runs against an empty state — the engine only reaches showdownReady later, mid
    // replay, where the board reveal is replay-guarded. Only the settle re-trigger can save it.
    a.engine.close();
    a.room.close();
    const a2 = await makePeer('A', 'room-A', shared, a.rsaPair);
    a2.room.members = ['A', 'B'];
    a2.room.pair(b.room);
    await a2.engine.returnToTable(1);          // <-- races ahead of the replay
    for (let i = 0; i < 3; i++) await flush();
    for (const e of currentHandWindow(shared)) {
      a2.room.listener.emit('event', e, (e as any).sender, true); // replay arrives AFTER
    }

    // The 80ms settle timer must fire (real time passes as waitFor polls) and run the board out.
    await waitFor(() => !!a2.engine.getStateSnapshot().winnersByRound.get(1), 'refreshed A resolves via settle', 60000);
    expect((a2.engine.getStateSnapshot().boardByRound.get(1) ?? []).length).toBe(5);
    a2.engine.close();
    b.engine.close();
  }, 120000);

  // THE OWNER'S ACCEPTANCE CRITERION, end-to-end: refresh, then PLAY TWO MORE HANDS.
  // This is the deep ROOT the watchdog only band-aids: after a refresh the rebuilt
  // MentalPokerGameRoom must be able to seal per-card keys to the partner for a BRAND
  // NEW hand. The partner's RSA encryption key was announced ONCE, before the first
  // hand, so the relay (which replays only from handStartSeq) never re-sends it — and
  // the in-memory peerEncryptionKeys map was wiped by the refresh. Unless that key is
  // recovered (persisted to localStorage / re-announced), the refreshed peer can never
  // seal the partner's hole cards and EVERY subsequent hand's deal stalls forever.
  test('MILESTONE 6 (ACCEPTANCE): refresh, then play TWO more hands to completion', async () => {
    const shared: GameEvent<AnyEvent>[] = [];
    const a = await makePeer('A', 'room-A', shared);
    const b = await makePeer('B', 'room-B', shared);
    a.room.pair(b.room);
    a.room.members = ['A', 'B'];
    b.room.members = ['A', 'B'];
    await a.mp.announceEncryptionKey();
    await b.mp.announceEncryptionKey();
    for (let i = 0; i < 20; i++) await flush();

    // --- Hand 1: a normal all-in, runs out and resolves on both sides. ---
    await a.engine.startNewRound({ initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2, bits: 1024, participants: ['A', 'B'] });
    await waitFor(() => (a.engine.getStateSnapshot().holesByRound.get(1)?.size ?? 0) > 0, 'h1 holes', 90000);
    await driveBetting({ A: a, B: b }, a, 1, (_who, fund) => fund);
    await waitFor(() => !!a.engine.getStateSnapshot().winnersByRound.get(1), 'h1 A resolves', 60000);
    await waitFor(() => !!b.engine.getStateSnapshot().winnersByRound.get(1), 'h1 B resolves', 60000);

    // --- REFRESH A between hands (relay-faithful: replays only the current-hand window,
    //     which does NOT include B's one-time encryption-key announce). ---
    let a2 = await refreshPeer(a, 'room-A', shared, b, ['A', 'B'], 1);

    // --- Hand 2: the refreshed A hosts a brand-new shuffle. For B's hole cards A must
    //     seal to B's encryption key — the exact thing a refresh used to lose. ---
    await a2.engine.startNewRound({ initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2, bits: 1024, participants: ['A', 'B'] });
    await waitFor(() => (a2.engine.getStateSnapshot().holesByRound.get(2)?.size ?? 0) > 0, 'h2 holes (refreshed A can deal)', 40000);
    await driveBetting({ A: a2, B: b }, a2, 2, (_who, fund) => fund);
    await waitFor(() => !!a2.engine.getStateSnapshot().winnersByRound.get(2), 'h2 refreshed-A resolves', 40000);
    await waitFor(() => !!b.engine.getStateSnapshot().winnersByRound.get(2), 'h2 B resolves', 40000);
    expect((a2.engine.getStateSnapshot().boardByRound.get(2) ?? []).length).toBe(5);

    // --- Hand 3: prove it KEEPS working (B hosts this one). ---
    await b.engine.startNewRound({ initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2, bits: 1024, participants: ['A', 'B'] });
    await waitFor(() => (a2.engine.getStateSnapshot().holesByRound.get(3)?.size ?? 0) > 0, 'h3 holes', 40000);
    await driveBetting({ A: a2, B: b }, b, 3, (_who, fund) => fund);
    await waitFor(() => !!a2.engine.getStateSnapshot().winnersByRound.get(3), 'h3 A resolves', 40000);
    await waitFor(() => !!b.engine.getStateSnapshot().winnersByRound.get(3), 'h3 B resolves', 40000);
    expect((a2.engine.getStateSnapshot().boardByRound.get(3) ?? []).length).toBe(5);

    // No divergence: the refreshed A and B must agree EXACTLY on both stacks, and the
    // table total must be conserved against whole buy-ins (200 initial + 100 per rebuy
    // of a busted player — heads-up all-ins routinely bust someone, so the total is a
    // positive multiple of the 100 buy-in, not necessarily the starting 200).
    const fa = a2.engine.getStateSnapshot().bankrolls;
    const fb = b.engine.getStateSnapshot().bankrolls;
    expect(fa.get('A') ?? 0).toBe(fb.get('A') ?? 0);
    expect(fa.get('B') ?? 0).toBe(fb.get('B') ?? 0);
    const total = (fa.get('A') ?? 0) + (fa.get('B') ?? 0);
    expect(total % 100).toBe(0);
    expect(total).toBeGreaterThanOrEqual(200);
    a2.engine.close();
    b.engine.close();
  }, 120000);

  // The owner's SECOND criterion: CLOSE the browser, then reopen. A real close wipes
  // sessionStorage (tab-scoped) but keeps localStorage (durable). The recovered
  // partner key must therefore live in localStorage — which this asserts by clearing
  // sessionStorage before the rebuild and then playing two fresh hands to completion.
  test('MILESTONE 7 (ACCEPTANCE): close-reopen (sessionStorage wiped), then play TWO more hands', async () => {
    const shared: GameEvent<AnyEvent>[] = [];
    const a = await makePeer('A', 'room-A', shared);
    const b = await makePeer('B', 'room-B', shared);
    a.room.pair(b.room);
    a.room.members = ['A', 'B'];
    b.room.members = ['A', 'B'];
    await a.mp.announceEncryptionKey();
    await b.mp.announceEncryptionKey();
    for (let i = 0; i < 20; i++) await flush();

    await a.engine.startNewRound({ initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2, bits: 1024, participants: ['A', 'B'] });
    await waitFor(() => (a.engine.getStateSnapshot().holesByRound.get(1)?.size ?? 0) > 0, 'h1 holes', 90000);
    await driveBetting({ A: a, B: b }, a, 1, (_who, fund) => fund);
    await waitFor(() => !!a.engine.getStateSnapshot().winnersByRound.get(1), 'h1 A resolves', 60000);
    await waitFor(() => !!b.engine.getStateSnapshot().winnersByRound.get(1), 'h1 B resolves', 60000);

    // === CLOSE the browser: wipe the tab-scoped sessionStorage. localStorage (where
    //     the partner's PUBLIC key now lives) survives, as it does on a real reopen. ===
    sessionStorage.clear();
    const a2 = await refreshPeer(a, 'room-A', shared, b, ['A', 'B'], 1);

    await a2.engine.startNewRound({ initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2, bits: 1024, participants: ['A', 'B'] });
    await waitFor(() => (a2.engine.getStateSnapshot().holesByRound.get(2)?.size ?? 0) > 0, 'h2 holes after reopen', 40000);
    await driveBetting({ A: a2, B: b }, a2, 2, (_who, fund) => fund);
    await waitFor(() => !!a2.engine.getStateSnapshot().winnersByRound.get(2), 'h2 A resolves after reopen', 40000);
    await waitFor(() => !!b.engine.getStateSnapshot().winnersByRound.get(2), 'h2 B resolves after reopen', 40000);
    expect((a2.engine.getStateSnapshot().boardByRound.get(2) ?? []).length).toBe(5);

    await b.engine.startNewRound({ initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2, bits: 1024, participants: ['A', 'B'] });
    await waitFor(() => (a2.engine.getStateSnapshot().holesByRound.get(3)?.size ?? 0) > 0, 'h3 holes', 40000);
    await driveBetting({ A: a2, B: b }, b, 3, (_who, fund) => fund);
    await waitFor(() => !!a2.engine.getStateSnapshot().winnersByRound.get(3), 'h3 A resolves', 40000);
    await waitFor(() => !!b.engine.getStateSnapshot().winnersByRound.get(3), 'h3 B resolves', 40000);
    expect((a2.engine.getStateSnapshot().boardByRound.get(3) ?? []).length).toBe(5);

    const fa = a2.engine.getStateSnapshot().bankrolls;
    const fb = b.engine.getStateSnapshot().bankrolls;
    expect(fa.get('A') ?? 0).toBe(fb.get('A') ?? 0);
    expect(fa.get('B') ?? 0).toBe(fb.get('B') ?? 0);
    a2.engine.close();
    b.engine.close();
  }, 120000);

  // THE OWNER'S EXACT REPRO (corrected): on A's turn, A REFRESHES the page FIRST, and only
  // AFTER recovering does A go all-in; then B calls. (Differs from M3, where A bet all-in
  // BEFORE refreshing.) The board must still run out. If the refreshed engine fails to
  // publish its board keys for an all-in it placed POST-recovery, this reproduces the live
  // stuck (left player publishes zero board keys → board never reveals).
  test('MILESTONE 8 (OWNER REPRO): A on turn → A REFRESHES → A all-in → B calls → board must run out', async () => {
    const shared: GameEvent<AnyEvent>[] = [];
    const a = await makePeer('A', 'room-A', shared);
    const b = await makePeer('B', 'room-B', shared);
    a.room.pair(b.room);
    a.room.members = ['A', 'B'];
    b.room.members = ['A', 'B'];
    await a.mp.announceEncryptionKey();
    await b.mp.announceEncryptionKey();
    for (let i = 0; i < 20; i++) await flush();

    await a.engine.startNewRound({ initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2, bits: 1024, participants: ['A', 'B'] });
    await waitFor(() => (a.engine.getStateSnapshot().holesByRound.get(1)?.size ?? 0) > 0, 'holes dealt', 90000);
    // It is A's turn and A has NOT acted yet.
    await waitFor(() => a.engine.getStateSnapshot().whoseTurnByRound.get(1)?.whoseTurn === 'A', 'A to act (pre-bet)', 30000);

    // === A REFRESHES THE PAGE *before* betting (full reload: new engine, replay the hand). ===
    const a2 = await refreshPeer(a, 'room-A', shared, b, ['A', 'B'], 1);
    await waitFor(() => a2.engine.getStateSnapshot().whoseTurnByRound.get(1)?.whoseTurn === 'A', 'refreshed A to act', 30000);

    // Only NOW does A go all-in; then B calls all-in.
    await a2.engine.bet(1, a2.engine.getStateSnapshot().bankrolls.get('A') ?? 0);
    await waitFor(() => b.engine.getStateSnapshot().whoseTurnByRound.get(1)?.whoseTurn === 'B', 'B to act', 30000);
    await b.engine.bet(1, b.engine.getStateSnapshot().bankrolls.get('B') ?? 0);

    // Board must run all the way out and BOTH must resolve.
    await waitFor(() => !!b.engine.getStateSnapshot().winnersByRound.get(1), 'B resolves', 60000);
    await waitFor(() => !!a2.engine.getStateSnapshot().winnersByRound.get(1), 'refreshed A resolves', 60000);
    expect((a2.engine.getStateSnapshot().boardByRound.get(1) ?? []).length).toBe(5);
    expect((b.engine.getStateSnapshot().boardByRound.get(1) ?? []).length).toBe(5);
    a2.engine.close();
    b.engine.close();
  }, 120000);

  // THE OWNER'S EXACT REPRO at the THIRD hand: play two all-in hands first, then on hand 3
  // (A's turn) A REFRESHES, recovers, goes all-in, B calls — board must run out. Tests whether
  // accumulated cross-hand state (round 3, rebuys, residual storage) breaks the post-refresh
  // all-in board reveal.
  test('MILESTONE 9 (OWNER REPRO @ hand 3): two hands, then hand-3 refresh-on-turn + all-in must run out', async () => {
    const shared: GameEvent<AnyEvent>[] = [];
    let a = await makePeer('A', 'room-A', shared);
    const b = await makePeer('B', 'room-B', shared);
    a.room.pair(b.room);
    a.room.members = ['A', 'B'];
    b.room.members = ['A', 'B'];
    await a.mp.announceEncryptionKey();
    await b.mp.announceEncryptionKey();
    for (let i = 0; i < 20; i++) await flush();

    // Hands 1 and 2: full all-in, run out, resolve.
    for (const hand of [1, 2]) {
      await a.engine.startNewRound({ initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2, bits: 1024, participants: ['A', 'B'] });
      await waitFor(() => (a.engine.getStateSnapshot().holesByRound.get(hand)?.size ?? 0) > 0, `h${hand} holes`, 90000);
      await driveBetting({ A: a, B: b }, a, hand, (_who, fund) => fund);
      await waitFor(() => !!a.engine.getStateSnapshot().winnersByRound.get(hand), `h${hand} A resolves`, 60000);
      await waitFor(() => !!b.engine.getStateSnapshot().winnersByRound.get(hand), `h${hand} B resolves`, 60000);
    }

    // Hand 3: deal, wait until A is on turn (not acted), then A REFRESHES first.
    await a.engine.startNewRound({ initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2, bits: 1024, participants: ['A', 'B'] });
    await waitFor(() => (a.engine.getStateSnapshot().holesByRound.get(3)?.size ?? 0) > 0, 'h3 holes', 90000);
    await waitFor(() => a.engine.getStateSnapshot().whoseTurnByRound.get(3)?.whoseTurn === 'A', 'h3 A to act (pre-bet)', 30000);

    const a2 = await refreshPeer(a, 'room-A', shared, b, ['A', 'B'], 3);
    await waitFor(() => a2.engine.getStateSnapshot().whoseTurnByRound.get(3)?.whoseTurn === 'A', 'h3 refreshed A to act', 30000);

    // Now A all-in, B calls all-in — board must run out and resolve on both.
    await a2.engine.bet(3, a2.engine.getStateSnapshot().bankrolls.get('A') ?? 0);
    await waitFor(() => b.engine.getStateSnapshot().whoseTurnByRound.get(3)?.whoseTurn === 'B', 'h3 B to act', 30000);
    const bCall = b.engine.getStateSnapshot().whoseTurnByRound.get(3)?.callAmount ?? 0;
    await b.engine.bet(3, Math.min(b.engine.getStateSnapshot().bankrolls.get('B') ?? 0, bCall)); // B CALLS the all-in

    await waitFor(() => !!b.engine.getStateSnapshot().winnersByRound.get(3), 'h3 B resolves', 60000);
    await waitFor(() => !!a2.engine.getStateSnapshot().winnersByRound.get(3), 'h3 refreshed A resolves', 60000);
    expect((a2.engine.getStateSnapshot().boardByRound.get(3) ?? []).length).toBe(5);
    a2.engine.close();
    b.engine.close();
  }, 120000);

  // THE OWNER'S LIVE STUCK (navigate-away / close-reopen, NOT a fast refresh): A LEAVES the
  // table long enough that B's member list actually DROPS A — B marks A disconnected and
  // PAUSES the hand. Then A returns, the pause clears, and only AFTER recovering does A go
  // all-in; B calls. The earlier milestones kept members=['A','B'] constant the whole time,
  // so they never exercised the disconnect→pause→reconnect cycle. This drives the real
  // 'members' events both ways, reproducing the path where the live board reveal stalled
  // (~40s, the 12s watchdog never fired) in the browser.
  test('MILESTONE 10 (NAVIGATE-AWAY): A leaves (B pauses) → A returns → A all-in → B calls → board must run out', async () => {
    const TABLE_ID = 'table-sim-m10';
    const shared: GameEvent<AnyEvent>[] = [];
    const a = await makePeer('A', 'room-A', shared, undefined, TABLE_ID);
    const b = await makePeer('B', 'room-B', shared, undefined, TABLE_ID);
    a.room.pair(b.room);
    a.room.members = ['A', 'B'];
    b.room.members = ['A', 'B'];
    await a.mp.announceEncryptionKey();
    await b.mp.announceEncryptionKey();
    for (let i = 0; i < 20; i++) await flush();

    // Hand 1: a normal all-in to build some history before the leave/return.
    await a.engine.startNewRound({ initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2, bits: 1024, participants: ['A', 'B'] });
    await waitFor(() => (a.engine.getStateSnapshot().holesByRound.get(1)?.size ?? 0) > 0, 'h1 holes', 90000);
    await driveBetting({ A: a, B: b }, a, 1, (_who, fund) => fund);
    await waitFor(() => !!a.engine.getStateSnapshot().winnersByRound.get(1), 'h1 A resolves', 60000);
    await waitFor(() => !!b.engine.getStateSnapshot().winnersByRound.get(1), 'h1 B resolves', 60000);

    // Save a funds-checkpoint between hands EXACTLY as the live useTexasHoldem hook does.
    // This is what the returning engine restores from — and what arms the skip-already-
    // counted-rounds guard during the WIDE navigate-away replay below.
    const afterH1 = a.engine.getStateSnapshot().bankrolls;
    localStorage.setItem(`fairpoker:funds-checkpoint:${TABLE_ID}`, JSON.stringify({
      throughRound: 1,
      funds: [['A', afterH1.get('A') ?? 0], ['B', afterH1.get('B') ?? 0]],
      boughtIn: [['A', 100], ['B', 100]],
    }));

    // Hand 2: deal, stop on A's turn (pre-flop), A has NOT acted. The button rotates each
    // hand, so if B (this hand's button) is first to act, B just CALLS to pass action to A
    // without committing more than the blind — keeping plenty of stack for the later all-in.
    await a.engine.startNewRound({ initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2, bits: 1024, participants: ['A', 'B'] });
    await waitFor(() => (a.engine.getStateSnapshot().holesByRound.get(2)?.size ?? 0) > 0, 'h2 holes', 90000);
    await waitFor(() => !!b.engine.getStateSnapshot().whoseTurnByRound.get(2)?.whoseTurn, 'h2 someone to act', 30000);
    for (let i = 0; i < 20 && b.engine.getStateSnapshot().whoseTurnByRound.get(2)?.whoseTurn === 'B'; i++) {
      const call = b.engine.getStateSnapshot().whoseTurnByRound.get(2)?.callAmount ?? 0;
      await b.engine.bet(2, call); // B calls to hand the turn to A
      for (let k = 0; k < 6; k++) await flush();
    }
    await waitFor(() => a.engine.getStateSnapshot().whoseTurnByRound.get(2)?.whoseTurn === 'A', 'h2 A to act (pre-bet)', 30000);

    // === A NAVIGATES AWAY: tear down A's engine+socket AND drop A from B's member list
    //     (a real ~15s absence — the worker broadcasts the smaller roster to B). ===
    a.engine.close();
    a.room.close();
    b.room.members = ['B'];
    b.room.listener.emit('members', ['B']);
    // Let B notice the drop and PAUSE the hand on the missing A.
    for (let i = 0; i < 40; i++) await flush();
    expect(b.engine.getStateSnapshot().handPauseByRound.get(2)?.missingPlayers ?? []).toContain('A');

    // === A RETURNS: rebuild with the same scope/identity. The engine constructor restores
    //     the funds-checkpoint. Replay the ENTIRE shared log (a full navigate-away makes the
    //     relay re-send from the start, far wider than one hand — this is the real path the
    //     fast-refresh milestones never hit), and bring A back into BOTH member lists. ===
    const a2 = await makePeer('A', 'room-A', shared, a.rsaPair, TABLE_ID);
    a2.room.members = ['A', 'B'];
    a2.room.pair(b.room);
    b.room.members = ['A', 'B'];
    b.room.listener.emit('members', ['A', 'B']);
    for (const e of shared.slice()) a2.room.listener.emit('event', e, (e as any).sender, true);
    for (let i = 0; i < 30; i++) await flush();
    await a2.engine.returnToTable(2);
    for (let i = 0; i < 20; i++) await flush();

    // The pause must clear and it must be A's turn again.
    await waitFor(() => !b.engine.getStateSnapshot().handPauseByRound.get(2), 'h2 pause cleared after A returns', 30000);
    await waitFor(() => a2.engine.getStateSnapshot().whoseTurnByRound.get(2)?.whoseTurn === 'A', 'h2 A to act after return', 30000);

    // Only NOW does A go all-in (post-recovery); B calls all-in. Board must run out on BOTH.
    await a2.engine.bet(2, a2.engine.getStateSnapshot().bankrolls.get('A') ?? 0);
    await waitFor(() => b.engine.getStateSnapshot().whoseTurnByRound.get(2)?.whoseTurn === 'B', 'h2 B to act', 30000);
    const bCall = b.engine.getStateSnapshot().whoseTurnByRound.get(2)?.callAmount ?? 0;
    await b.engine.bet(2, Math.min(b.engine.getStateSnapshot().bankrolls.get('B') ?? 0, bCall));

    await waitFor(() => !!b.engine.getStateSnapshot().winnersByRound.get(2), 'h2 B resolves', 60000);
    await waitFor(() => !!a2.engine.getStateSnapshot().winnersByRound.get(2), 'h2 returned-A resolves', 60000);
    expect((a2.engine.getStateSnapshot().boardByRound.get(2) ?? []).length).toBe(5);
    expect((b.engine.getStateSnapshot().boardByRound.get(2) ?? []).length).toBe(5);
    a2.engine.close();
    b.engine.close();
  }, 120000);
});
