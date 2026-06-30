// Round-3 bounty fixes — reducer-side PoCs proving the forged-event attacks the auditor
// landed against the pure reducer are now blocked, while legitimate play is unchanged.
//   E-1: a bare hand/result can no longer void/refund a live hand (see cardReveals-and-pnl).
//   E-2: a mid-hand / duplicate / replayed newRound can no longer destroy or skim chips.
//   D-1: a forged autoFold can no longer fold an opponent who is not on the clock.

import { reduceTexasHoldem, ReducerEvent } from "./texasHoldemReducer";

const settings = { initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2, autoFoldTimeoutSeconds: 60 };
const newRound = (round: number, players: string[], relayTs?: number): ReducerEvent =>
  ({ type: 'newRound', from: players[0], round, players, settings, relayTs });
const bet = (round: number, from: string, amount: number, relayTs?: number): ReducerEvent =>
  ({ type: 'action/bet', from, round, amount, relayTs });
const autoFold = (round: number, from: string, target: string, relayTs?: number): ReducerEvent =>
  ({ type: 'action/autoFold', from, round, target, relayTs });
const fold = (round: number, from: string): ReducerEvent => ({ type: 'action/fold', from, round });

const fundsTotal = (s: ReturnType<typeof reduceTexasHoldem>) =>
  Array.from(s.funds.values()).reduce((a, b) => a + b, 0);
const boughtInTotal = (s: ReturnType<typeof reduceTexasHoldem>) =>
  Array.from(s.boughtIn.values()).reduce((a, b) => a + b, 0);

describe('E-2: newRound can no longer destroy or skim chips', () => {
  test('a newRound mid-hand is ignored — the live pot is not vaporized', () => {
    // A and B commit 2 each (pot=4), then A forges a restart for round 2 while round 1 is live.
    const log = [newRound(1, ['A', 'B']), bet(1, 'A', 1), newRound(2, ['A', 'B'])];
    const s = reduceTexasHoldem(log, new Map(), ['A', 'B']);
    // The forged newRound(2) is rejected: still on round 1, no round 2, pot intact.
    expect(s.currentRound).toBe(1);
    expect(s.rounds.has(2)).toBe(false);
    const pot = s.rounds.get(1)!.pot;
    expect((pot.get('A') ?? 0) + (pot.get('B') ?? 0)).toBe(4); // chips preserved in the pot
    // Resolving round 1 normally (A folds) conserves every chip — none were destroyed.
    const resolved = reduceTexasHoldem([...log, fold(1, 'A')], new Map(), ['A', 'B']);
    expect(fundsTotal(resolved)).toBe(boughtInTotal(resolved));
  });

  test('a duplicate round number is idempotent — a replay cannot reset the hand', () => {
    const log = [newRound(1, ['A', 'B']), bet(1, 'A', 1), newRound(1, ['A', 'B'])];
    const s = reduceTexasHoldem(log, new Map(), ['A', 'B']);
    // The second newRound(1) is a no-op: A's completed bet (committed 2) still stands.
    expect(s.rounds.get(1)!.pot.get('A')).toBe(2);
  });

  test('a duplicate-self seat list is deduped — one identity cannot hold two seats', () => {
    const s = reduceTexasHoldem([newRound(1, ['A', 'A', 'B'])], new Map(), ['A', 'B']);
    expect(s.rounds.get(1)!.players).toEqual(['A', 'B']); // 'A' seated once, not twice
  });

  test('a newRound with fewer than two distinct players is rejected', () => {
    const s = reduceTexasHoldem([newRound(1, ['A', 'A'])], new Map(), ['A']);
    expect(s.currentRound).toBe(null);
    expect(s.handInProgress).toBe(false);
  });
});

describe('D-1 / R4·01: an auto-fold is self-authorized (or for a truly-missing player) — never a forged relay timeout', () => {
  // R4·01 hardening: a timeout no longer relies on the relay's (unsigned, operator-controlled)
  // receive-timestamp to prove time elapsed. A player is auto-folded only when THEIR OWN client
  // emits it (from === target) or when they are genuinely unreachable; folding a PRESENT opponent
  // on someone else's word — even with a forged future relay timestamp — is refused, so a relay
  // colluding with a seat can no longer fake a timeout to fold an on-turn opponent and take the pot.
  test('autoFold targeting a non-turn opponent is ignored — no pot theft', () => {
    // Heads-up round 1: after blinds it is X's turn (first to act). X forges an autoFold against
    // the opponent V while it is NOT V's turn — dropped (wrong turn owner).
    const log = [newRound(1, ['X', 'V']), autoFold(1, 'X', 'V')];
    const s = reduceTexasHoldem(log, new Map(), ['X', 'V']);
    expect(s.rounds.get(1)!.folded.has('V')).toBe(false); // V is NOT folded
    expect(s.rounds.get(1)!.result).toBeUndefined();       // hand not resolved/stolen
    expect(s.handInProgress).toBe(true);
  });

  test('a SELF-fold (the on-turn player\'s own client times out) still works', () => {
    // It is X's turn; X's own client times out and emits a self-autoFold → X folds, V wins.
    const log = [newRound(1, ['X', 'V']), autoFold(1, 'X', 'X')];
    const s = reduceTexasHoldem(log, new Map(), ['X', 'V']);
    expect(s.rounds.get(1)!.folded.has('X')).toBe(true);     // X self-folded on its own timeout
    expect(s.rounds.get(1)!.result?.how).toBe('LastOneWins'); // V wins the fold-out
  });

  test('a forged cross-player fold of a PRESENT on-turn opponent is refused — even with a future relay timestamp', () => {
    // X passes the turn to V, then forges autoFold(V) claiming a full 60s elapsed. V is present, and
    // the fold is from X (not V), so it is refused regardless of the relay-stamped time.
    const log = [
      newRound(1, ['X', 'V'], 1000),
      bet(1, 'X', 1, 2000),                 // turn passes to V
      autoFold(1, 'X', 'V', 2000 + 60_000), // forged "V timed out 60s ago"
    ];
    const s = reduceTexasHoldem(log, new Map(), ['X', 'V']); // V present
    expect(s.rounds.get(1)!.folded.has('V')).toBe(false);    // V NOT folded — steal blocked
    expect(s.rounds.get(1)!.result).toBeUndefined();
  });

  test('the steal result is independent of the relay timestamp', () => {
    const mk = (ts: number) => reduceTexasHoldem(
      [newRound(1, ['X', 'V'], 1000), bet(1, 'X', 1, 2000), autoFold(1, 'X', 'V', ts)],
      new Map(), ['X', 'V']);
    expect(mk(2050).rounds.get(1)!.folded.has('V')).toBe(false);       // ~0s
    expect(mk(2000 + 9_999_999).rounds.get(1)!.folded.has('V')).toBe(false); // huge forged gap — same
  });

  test('an UNREACHABLE on-turn player can be folded so the table never freezes', () => {
    // V drops on its turn; an autoFold from X is honored because V is genuinely unreachable.
    const log = [newRound(1, ['X', 'V'], 1000), bet(1, 'X', 1, 2000), autoFold(1, 'X', 'V')];
    const s = reduceTexasHoldem(log, new Map(), ['X']); // V is gone (not in the reachable set)
    expect(s.rounds.get(1)!.folded.has('V')).toBe(true);
    expect(s.rounds.get(1)!.result?.how).toBe('LastOneWins'); // X wins, hand resolves (no freeze)
  });
});
