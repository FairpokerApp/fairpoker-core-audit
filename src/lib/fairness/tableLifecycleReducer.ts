// Deterministic table-lifecycle reducer (Stage 1 of the audit-aligned rework).
//
// Single source of truth for SEATING / ROUND-LIFECYCLE / PRESENCE, computed
// purely from the ordered table events plus who is currently reachable. This is
// the client-side replacement for trusting the Worker's computed roomState: the
// browser derives "who is seated / watching / whose hand it is / can we start"
// itself, so the operator/relay holds no referee power (audit B08, D01, C09–C13).
//
// Scope: lobby/seat/round lifecycle only — NOT betting math or showdown (those
// live in the hand-integrity reducer shared with the transcript verifier). This
// module is pure: same (events, connected) in => same state out. No emitters, no
// timers, no network, no Date.now.
//
// Behavior note: a player who drops mid-hand counts as "missing" only while they
// are actually unreachable. The moment they are reachable again they rejoin the
// same hand — there is no sticky per-hand lock-out (that lock-out was the old
// "refresh = stuck" bug). Turning "missing past a consensus deadline" into a fold
// is Stage 2/3 and is intentionally NOT decided here.

export type LifecyclePlayerStatus =
  | 'active' // seated and in play
  | 'watching' // online but not seated for the current hand
  | 'sittingOut' // voluntarily sitting out
  | 'timedOut' // auto-folded for inactivity
  | 'missing' // a current-hand player who is currently unreachable
  | 'offline'; // known player who is not connected and not in a live hand

export interface LifecyclePlayer {
  peerId: string;
  online: boolean;
  seated: boolean;
  status: LifecyclePlayerStatus;
}

export interface TableLifecycleState {
  currentRound: number | null;
  currentPlayers: string[]; // ordered seats dealt into the current hand
  handInProgress: boolean; // a hand is live (started, not yet resolved)
  players: LifecyclePlayer[]; // every known peer, sorted by peerId
  seatedPlayers: string[]; // peers eligible to play the next hand
  missingPlayers: string[]; // current-hand players who are unreachable right now
  activePlayerCount: number;
  playable: boolean; // enough seated players to start/continue a hand
}

// Normalized lifecycle event. `from` is the signed sender (or worker for system
// events). Only the fields the lifecycle cares about are modeled.
export interface LifecycleEvent {
  type:
    | 'newRound'
    | 'hand/result' // explicit "this hand is over" signal (the missing piece, see plan §6)
    | 'action/sitOut'
    | 'action/returnToTable'
    | 'action/openRegistration'
    | 'action/autoFold'
    | 'action/fold'
    | 'action/bet';
  from?: string;
  round?: number | null;
  players?: string[]; // newRound seat order
  target?: string; // autoFold target
}

interface MutableState {
  currentRound: number | null;
  currentPlayers: string[];
  roundComplete: boolean; // the current round has a signed hand/result -> hand is over
  knownPeers: Set<string>;
  seated: Set<string>;
  sittingOut: Set<string>;
  timedOut: Set<string>;
  folded: Set<string>; // folded in the current hand (for completeness)
}

function note(peers: Set<string>, peerId: string | undefined) {
  if (peerId) {
    peers.add(peerId);
  }
}

function applyEvent(state: MutableState, event: LifecycleEvent): void {
  switch (event.type) {
    case 'action/openRegistration':
      state.seated.clear();
      state.sittingOut.clear();
      state.timedOut.clear();
      state.folded.clear();
      state.currentRound = null;
      state.currentPlayers = [];
      state.roundComplete = false;
      note(state.knownPeers, event.from);
      return;
    case 'hand/result':
      // Explicit "this hand is over" signal. Marks the current round complete so
      // seating returns to the lobby rule (everyone reachable is seatable for the
      // next hand) WITHOUT waiting for an openRegistration — this is what makes
      // "both stuck on 观战中 until a double refresh" impossible. (See plan §6.)
      if (typeof event.round === 'number' && event.round === state.currentRound) {
        state.roundComplete = true;
      }
      note(state.knownPeers, event.from);
      return;
    case 'newRound': {
      const players = (event.players ?? []).filter(p => typeof p === 'string');
      state.currentRound = typeof event.round === 'number' ? event.round : state.currentRound;
      state.currentPlayers = players;
      state.roundComplete = false;
      state.folded.clear();
      for (const player of players) {
        state.knownPeers.add(player);
        state.seated.add(player);
        state.sittingOut.delete(player);
        state.timedOut.delete(player);
      }
      return;
    }
    case 'action/sitOut':
      if (event.from) {
        state.sittingOut.add(event.from);
        state.seated.delete(event.from);
        note(state.knownPeers, event.from);
      }
      return;
    case 'action/returnToTable':
      if (event.from) {
        state.sittingOut.delete(event.from);
        state.timedOut.delete(event.from);
        state.seated.add(event.from);
        note(state.knownPeers, event.from);
      }
      return;
    case 'action/autoFold':
      if (event.target) {
        state.timedOut.add(event.target);
        state.sittingOut.add(event.target);
        state.seated.delete(event.target);
        state.folded.add(event.target);
        note(state.knownPeers, event.target);
      }
      return;
    case 'action/fold':
      if (event.from) {
        state.folded.add(event.from);
        note(state.knownPeers, event.from);
      }
      return;
    case 'action/bet':
      if (event.from) {
        state.timedOut.delete(event.from);
        note(state.knownPeers, event.from);
      }
      return;
  }
}

/**
 * Reduce the ordered lifecycle events plus the currently-reachable peer set into
 * the canonical seating/lifecycle view. Pure and deterministic.
 */
export function reduceTableLifecycle(
  events: LifecycleEvent[],
  connected: Iterable<string>,
): TableLifecycleState {
  const connectedList = Array.from(connected);
  const connectedSet = new Set(connectedList);
  const state: MutableState = {
    currentRound: null,
    currentPlayers: [],
    roundComplete: false,
    knownPeers: new Set<string>(),
    seated: new Set<string>(),
    sittingOut: new Set<string>(),
    timedOut: new Set<string>(),
    folded: new Set<string>(),
  };

  for (const peerId of connectedList) {
    state.knownPeers.add(peerId);
  }
  for (const event of events) {
    applyEvent(state, event);
  }

  const handInProgress = state.currentRound !== null && !state.roundComplete;

  // Lobby OR a finished hand: every reachable peer who has not opted out is
  // seatable for the next hand. A finished hand no longer holds seats — this is
  // what prevents the "stuck on 观战中 until a double refresh" state.
  if (!handInProgress) {
    for (const peerId of connectedList) {
      if (!state.sittingOut.has(peerId) && !state.timedOut.has(peerId)) {
        state.seated.add(peerId);
      }
    }
  }

  // Only an in-progress hand can have "missing" players it is waiting on. Such a
  // player is a current seat who is not folded and is unreachable right now; they
  // rejoin the instant they return (no sticky per-hand lock-out).
  const missing = new Set<string>();
  if (handInProgress) {
    for (const peerId of state.currentPlayers) {
      if (!connectedSet.has(peerId) && !state.folded.has(peerId)) {
        missing.add(peerId);
      }
    }
  }

  const players: LifecyclePlayer[] = Array.from(state.knownPeers).sort().map(peerId => {
    const online = connectedSet.has(peerId);
    const isMissing = missing.has(peerId);
    const seated = state.seated.has(peerId)
      && online
      && !state.sittingOut.has(peerId)
      && !state.timedOut.has(peerId);
    const status: LifecyclePlayerStatus = !online
      ? (isMissing ? 'missing' : 'offline')
      : seated
        ? 'active'
        : state.timedOut.has(peerId)
          ? 'timedOut'
          : state.sittingOut.has(peerId)
            ? 'sittingOut'
            : 'watching';
    return { peerId, online, seated, status };
  });

  const seatedPlayers = players.filter(p => p.seated).map(p => p.peerId);

  return {
    currentRound: state.currentRound,
    currentPlayers: state.currentPlayers,
    handInProgress,
    players,
    seatedPlayers,
    missingPlayers: Array.from(missing).sort(),
    activePlayerCount: seatedPlayers.length,
    playable: seatedPlayers.length >= 2,
  };
}
