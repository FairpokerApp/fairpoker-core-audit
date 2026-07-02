import {auditHandIntegrity, AuditEntryLike, IntegrityCheck} from "./handIntegrityAudit";
import {SIGNED_EVENT_KIND} from "./eventSigning";

const ROUND = 1;
const PLAYERS = ['alice', 'bob', 'carol', 'dave', 'erin'];

function signed(payload: object, signature: string): AuditEntryLike {
  return {scope: 'public', wireEvent: {kind: SIGNED_EVENT_KIND, payload, signature}};
}

function deck(unique = true): string[] {
  const cards = Array.from({length: 52}, (_, i) => `ciphertext-${i}`);
  if (!unique) {
    cards[51] = cards[0];
  }
  return cards;
}

function cleanHand(
  participants: string[],
  opts: {dropShuffleFor?: string; unique?: boolean} = {},
): AuditEntryLike[] {
  const entries: AuditEntryLike[] = [];
  participants.forEach((player, i) => {
    if (opts.dropShuffleFor === player) {
      return;
    }
    entries.push(signed({type: 'deck/shuffle', round: ROUND, player, shuffleIndex: i}, `sig-shuffle-${i}`));
  });
  participants.forEach((player, i) => {
    entries.push(signed({type: 'deck/lock', round: ROUND, player, lockIndex: i}, `sig-lock-${i}`));
  });
  entries.push(signed(
    {type: 'deck/finalized', round: ROUND, player: participants[participants.length - 1], deck: deck(opts.unique ?? true)},
    'sig-finalized',
  ));
  return entries;
}

function check(result: {checks: IntegrityCheck[]}, id: IntegrityCheck['id']): IntegrityCheck {
  const found = result.checks.find((c) => c.id === id);
  if (!found) {
    throw new Error(`missing check ${id}`);
  }
  return found;
}

describe('auditHandIntegrity', () => {
  it('passes a clean five-player hand (consensus pending without peers)', async () => {
    const result = await auditHandIntegrity({entries: cleanHand(PLAYERS), round: ROUND, participants: PLAYERS});
    expect(result.status).toBe('pass');
    expect(check(result, 'deckIntegrity').status).toBe('pass');
    expect(check(result, 'fullShuffle').status).toBe('pass');
    expect(check(result, 'signatures').status).toBe('pass');
    // No peer receipts yet -> consensus is pending, which must NOT fail the hand.
    expect(check(result, 'recordConsensus').status).toBe('pending');
    expect(result.handHash).toMatch(/^sha256:/);
  });

  it('flags a forged deck (duplicate ciphertext = same card twice)', async () => {
    const result = await auditHandIntegrity({
      entries: cleanHand(PLAYERS, {unique: false}),
      round: ROUND,
      participants: PLAYERS,
    });
    expect(result.status).toBe('warn');
    const deckCheck = check(result, 'deckIntegrity');
    expect(deckCheck.status).toBe('warn');
    expect(deckCheck.reasonCode).toBe('duplicate-ciphertext');
  });

  it('flags an incomplete shuffle when a participant never shuffled', async () => {
    const result = await auditHandIntegrity({
      entries: cleanHand(PLAYERS, {dropShuffleFor: 'carol'}),
      round: ROUND,
      participants: PLAYERS,
    });
    expect(result.status).toBe('warn');
    const shuffleCheck = check(result, 'fullShuffle');
    expect(shuffleCheck.status).toBe('warn');
    expect(shuffleCheck.reasonCode).toBe('incomplete-shuffle');
  });

  it('does NOT flag an incomplete shuffle on a VOIDED hand (a mid-shuffle refresh legitimately cut it short)', async () => {
    // Same interrupted shuffle as above, but the hand was voided/refunded — a deal-phase void
    // (e.g. a mid-shuffle refresh) legitimately leaves the shuffle incomplete, so it must not
    // raise a false "a player skipped the shuffle" cheating alarm. The shuffle check reports
    // not-evaluated and the overall verdict is not a warning.
    const result = await auditHandIntegrity({
      entries: cleanHand(PLAYERS, {dropShuffleFor: 'carol'}),
      round: ROUND,
      participants: PLAYERS,
      voided: true,
    });
    const shuffleCheck = check(result, 'fullShuffle');
    expect(shuffleCheck.status).toBe('pending');
    expect(shuffleCheck.reasonCode).toBe('voided-hand');
    expect(result.status).not.toBe('warn');
  });

  it('agrees when a peer receipt matches the local hand hash', async () => {
    const entries = cleanHand(PLAYERS);
    const first = await auditHandIntegrity({entries, round: ROUND, participants: PLAYERS});
    const agreed = await auditHandIntegrity({
      entries,
      round: ROUND,
      participants: PLAYERS,
      peerReceipts: [{signer: 'bob', handHash: first.handHash as string}],
    });
    expect(agreed.status).toBe('pass');
    expect(check(agreed, 'recordConsensus').status).toBe('pass');
  });

  it('flags diverged records when a peer reports a different hand hash', async () => {
    const result = await auditHandIntegrity({
      entries: cleanHand(PLAYERS),
      round: ROUND,
      participants: PLAYERS,
      peerReceipts: [{signer: 'mallory', handHash: 'sha256:totally-different'}],
    });
    expect(result.status).toBe('warn');
    const consensus = check(result, 'recordConsensus');
    expect(consensus.status).toBe('warn');
    expect(consensus.reasonCode).toBe('record-diverged');
  });

  it('flags an unsigned public event', async () => {
    const entries = cleanHand(PLAYERS);
    entries.push({scope: 'public', wireEvent: {type: 'bet', round: ROUND, player: 'alice', amount: 10}});
    const result = await auditHandIntegrity({entries, round: ROUND, participants: PLAYERS});
    expect(result.status).toBe('warn');
    const sigCheck = check(result, 'signatures');
    expect(sigCheck.status).toBe('warn');
    expect(sigCheck.reasonCode).toBe('unsigned-event');
  });

  it('stays pending (not warn) for a hand with no dealing events yet', async () => {
    const result = await auditHandIntegrity({entries: [], round: ROUND, participants: PLAYERS});
    expect(result.status).toBe('pending');
    expect(check(result, 'deckIntegrity').status).toBe('pending');
  });
});
