import { reduceTableLifecycle, LifecycleEvent } from './tableLifecycleReducer';

function statusOf(state: ReturnType<typeof reduceTableLifecycle>, peerId: string) {
  return state.players.find(p => p.peerId === peerId)?.status;
}

describe('reduceTableLifecycle', () => {
  it('seats every reachable peer in the lobby (no active hand)', () => {
    const state = reduceTableLifecycle([], ['A', 'B']);
    expect(state.currentRound).toBeNull();
    expect(state.seatedPlayers).toEqual(['A', 'B']);
    expect(state.playable).toBe(true);
    expect(statusOf(state, 'A')).toBe('active');
  });

  it('is not playable with fewer than two seated peers', () => {
    const state = reduceTableLifecycle([], ['A']);
    expect(state.playable).toBe(false);
  });

  it('marks the dealt players active during a hand', () => {
    const events: LifecycleEvent[] = [
      { type: 'newRound', from: 'A', round: 1, players: ['A', 'B', 'C'] },
    ];
    const state = reduceTableLifecycle(events, ['A', 'B', 'C']);
    expect(state.currentRound).toBe(1);
    expect(state.currentPlayers).toEqual(['A', 'B', 'C']);
    expect(state.missingPlayers).toEqual([]);
    expect(statusOf(state, 'C')).toBe('active');
  });

  it('treats a dropped current-hand player as missing, then rejoins on reconnect', () => {
    const events: LifecycleEvent[] = [
      { type: 'newRound', from: 'A', round: 1, players: ['A', 'B', 'C'] },
    ];
    // C drops mid-hand.
    const dropped = reduceTableLifecycle(events, ['A', 'B']);
    expect(dropped.missingPlayers).toEqual(['C']);
    expect(statusOf(dropped, 'C')).toBe('missing');

    // C reconnects — rejoins the SAME hand, no sticky lock-out.
    const rejoined = reduceTableLifecycle(events, ['A', 'B', 'C']);
    expect(rejoined.missingPlayers).toEqual([]);
    expect(statusOf(rejoined, 'C')).toBe('active');
  });

  it('does not treat a folded player as missing when they drop', () => {
    const events: LifecycleEvent[] = [
      { type: 'newRound', from: 'A', round: 1, players: ['A', 'B', 'C'] },
      { type: 'action/fold', from: 'C' },
    ];
    const state = reduceTableLifecycle(events, ['A', 'B']);
    expect(state.missingPlayers).toEqual([]);
  });

  it('handles sitOut then returnToTable', () => {
    const sat = reduceTableLifecycle([{ type: 'action/sitOut', from: 'B' }], ['A', 'B']);
    expect(statusOf(sat, 'B')).toBe('sittingOut');
    expect(sat.seatedPlayers).toEqual(['A']);

    const returned = reduceTableLifecycle(
      [{ type: 'action/sitOut', from: 'B' }, { type: 'action/returnToTable', from: 'B' }],
      ['A', 'B'],
    );
    expect(statusOf(returned, 'B')).toBe('active');
    expect(returned.seatedPlayers).toEqual(['A', 'B']);
  });

  it('auto-fold marks the target timedOut until they return', () => {
    const events: LifecycleEvent[] = [
      { type: 'newRound', from: 'A', round: 1, players: ['A', 'B'] },
      { type: 'action/autoFold', from: 'A', target: 'B' },
    ];
    const timedOut = reduceTableLifecycle(events, ['A', 'B']);
    expect(statusOf(timedOut, 'B')).toBe('timedOut');

    const returned = reduceTableLifecycle(
      [...events, { type: 'action/returnToTable', from: 'B' }],
      ['A', 'B'],
    );
    expect(statusOf(returned, 'B')).toBe('active');
  });

  it('openRegistration clears the round and re-seats reachable peers', () => {
    const events: LifecycleEvent[] = [
      { type: 'newRound', from: 'A', round: 1, players: ['A', 'B'] },
      { type: 'action/autoFold', from: 'A', target: 'B' },
      { type: 'action/openRegistration', from: 'A' },
    ];
    const state = reduceTableLifecycle(events, ['A', 'B']);
    expect(state.currentRound).toBeNull();
    expect(state.seatedPlayers).toEqual(['A', 'B']);
    expect(statusOf(state, 'B')).toBe('active');
  });

  it('a hand/result ends the round so players are re-seatable without openRegistration', () => {
    // This is the exact "both stuck on 观战中 until a double refresh" case: once
    // the hand is over, seating returns to the lobby rule deterministically.
    const events: LifecycleEvent[] = [
      { type: 'newRound', from: 'A', round: 1, players: ['A', 'B'] },
      { type: 'hand/result', from: 'A', round: 1 },
    ];
    const state = reduceTableLifecycle(events, ['A', 'B']);
    expect(state.handInProgress).toBe(false);
    expect(state.missingPlayers).toEqual([]);
    expect(state.seatedPlayers).toEqual(['A', 'B']);
    expect(state.playable).toBe(true);
    expect(statusOf(state, 'A')).toBe('active');
  });

  it('a player who drops after the hand ended is not "missing"', () => {
    const events: LifecycleEvent[] = [
      { type: 'newRound', from: 'A', round: 1, players: ['A', 'B'] },
      { type: 'hand/result', from: 'A', round: 1 },
    ];
    const state = reduceTableLifecycle(events, ['A']); // B left after the hand
    expect(state.handInProgress).toBe(false);
    expect(state.missingPlayers).toEqual([]);
    expect(state.playable).toBe(false); // only A reachable now
  });

  it('the next newRound after a result is a fresh in-progress hand', () => {
    const events: LifecycleEvent[] = [
      { type: 'newRound', from: 'A', round: 1, players: ['A', 'B'] },
      { type: 'hand/result', from: 'A', round: 1 },
      { type: 'newRound', from: 'A', round: 2, players: ['A', 'B'] },
    ];
    const state = reduceTableLifecycle(events, ['A', 'B']);
    expect(state.handInProgress).toBe(true);
    expect(state.currentRound).toBe(2);
  });

  it('ignores a hand/result for a non-current round', () => {
    const events: LifecycleEvent[] = [
      { type: 'newRound', from: 'A', round: 2, players: ['A', 'B'] },
      { type: 'hand/result', from: 'A', round: 1 },
    ];
    const state = reduceTableLifecycle(events, ['A', 'B']);
    expect(state.handInProgress).toBe(true);
  });

  it('is deterministic: same inputs produce equal output', () => {
    const events: LifecycleEvent[] = [
      { type: 'newRound', from: 'A', round: 1, players: ['A', 'B'] },
    ];
    const a = reduceTableLifecycle(events, ['A', 'B']);
    const b = reduceTableLifecycle(events, ['A', 'B']);
    expect(a).toEqual(b);
  });
});
