// Parity proof: the OFFLINE downloadable verifier (scripts/verify-transcript.js, a
// standalone node tool) and the LIVE browser-authoritative reducer
// (texasHoldemReducer) must compute the SAME chip outcome for a hand. They are two
// implementations today (the verifier is portable JS so anyone can run it with just
// `node`, the live game is TS), and the roadmap's "unify verifier + live logic" item
// is about guaranteeing they never disagree. This test pins that: it builds real
// SIGNED transcripts of fold-out hands (which need no showdown decryption), runs the
// actual verify-transcript.js CLI on them, and asserts its finalFunds match
// reduceTexasHoldem run over the same signed log. Any divergence fails CI.
//
// (Showdown side-pot parity additionally needs real per-card decryption to feed the
// verifier; that path is covered by verifyTranscriptCli.test.ts fixtures and is the
// remaining step toward a single shared reducer module.)

import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { createEventSigner, EventSigner, generateSigningIdentity } from "./eventSigning";
import { TranscriptRecorder, TranscriptSnapshot } from "./transcript";
import { reduceTexasHoldem, transcriptToReducerEvents, CardReveals } from "../texas-holdem/texasHoldemReducer";
import { StandardCard } from "../secureMentalPoker";

type Payload = Record<string, unknown>;

// Same code→card decoding the verifier uses (scripts/verify-transcript.js), so the
// reducer evaluates the identical cards at showdown.
const SUIT_DECODING: Record<number, StandardCard['suit']> = { 1: 'Heart', 2: 'Diamond', 3: 'Club', 4: 'Spade' };
const RANK_DECODING: Record<number, StandardCard['rank']> =
  { 1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: 'T', 11: 'J', 12: 'Q', 13: 'K' };
function decodeCode(value: number): StandardCard {
  let rankCode = value % 13;
  if (rankCode === 0) rankCode = 13;
  const suitCode = Math.floor((value - 1) / 13) + 1;
  return { suit: SUIT_DECODING[suitCode], rank: RANK_DECODING[rankCode] };
}
function makePlainFinalDeck(codesByOffset: Record<number, number>): string[] {
  // codesByOffset are 1..52 card indices; encode each as (index+1)^2 to match the real client +
  // verifier (Audit R4-11/R4-12) instead of feeding raw 1..52.
  const enc = (code: number) => String((code + 1) * (code + 1));
  const used = new Set(Object.values(codesByOffset));
  const remaining = Array.from({ length: 52 }, (_, i) => i + 1).filter(c => !used.has(c));
  return Array.from({ length: 52 }, (_, offset) => enc(codesByOffset[offset] ?? remaining.shift()!));
}
const verifierPath = path.resolve(__dirname, "../../../scripts/verify-transcript.js");
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function makeDeck(prefix: string): string[] {
  return Array.from({ length: 52 }, (_, i) => `${prefix}-${i}`);
}

async function twoSigners(): Promise<{ alice: EventSigner; bob: EventSigner }> {
  const [a, b] = await Promise.all([generateSigningIdentity(), generateSigningIdentity()]);
  const [alice, bob] = await Promise.all([createEventSigner(a), createEventSigner(b)]);
  return { alice, bob };
}

async function appendSigned(recorder: TranscriptRecorder<Payload>, signer: EventSigner, payload: Payload): Promise<void> {
  const signed = await signer.sign({ sender: signer.identity.peerId, scope: "public", payload });
  await recorder.append({ transportSender: signer.identity.peerId, scope: "public", wireEvent: signed });
}

async function appendFinalizedDeck(recorder: TranscriptRecorder<Payload>, alice: EventSigner, bob: EventSigner): Promise<void> {
  const round = 1;
  await appendSigned(recorder, alice, { type: "start", round, mentalPokerSettings: { alice: alice.identity.peerId, bob: bob.identity.peerId } });
  await appendSigned(recorder, alice, { type: "deck/step1", round, deck: makeDeck("a-enc"), publicKey: { p: "a-p", q: "a-q" } });
  await appendSigned(recorder, bob, { type: "deck/step2", round, deck: makeDeck("b-enc") });
  await appendSigned(recorder, alice, { type: "deck/step3", round, deck: makeDeck("a-rm") });
  await appendSigned(recorder, bob, { type: "deck/finalized", round, deck: makeDeck("final") });
}

type Action = { by: 'alice' | 'bob'; bet?: number; fold?: true };

// Build a signed fold-out transcript: finalized deck + newRound + the given action line.
async function buildFoldOutTranscript(actions: Action[]): Promise<{ snapshot: TranscriptSnapshot<Payload>; alice: string; bob: string }> {
  const { alice, bob } = await twoSigners();
  const recorder = new TranscriptRecorder<Payload>();
  await appendFinalizedDeck(recorder, alice, bob);
  await appendSigned(recorder, alice, {
    type: "newRound", round: 1,
    players: [alice.identity.peerId, bob.identity.peerId],
    settings: { initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2 },
  });
  for (const a of actions) {
    const signer = a.by === 'alice' ? alice : bob;
    if (a.fold) {
      await appendSigned(recorder, signer, { type: "action/fold", round: 1 });
    } else {
      await appendSigned(recorder, signer, { type: "action/bet", round: 1, amount: a.bet ?? 0 });
    }
  }
  return { snapshot: recorder.snapshot(), alice: alice.identity.peerId, bob: bob.identity.peerId };
}

function runVerifierFinalFunds(snapshot: TranscriptSnapshot<Payload>): Map<string, number> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-parity-"));
  tempDirs.push(dir);
  const file = path.join(dir, "transcript.json");
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
  const stdout = execFileSync(process.execPath, [verifierPath, file], { encoding: "utf8" });
  const result = JSON.parse(stdout);
  expect(result.ok).toBe(true); // the transcript must be fully valid (signatures, deck, betting)
  const round1 = result.gameProtocol.rounds.find((r: any) => r.round === 1);
  const funds = new Map<string, number>();
  for (const { player, amount } of round1.texasHoldem.finalFunds as Array<{ player: string; amount: number }>) {
    funds.set(player, amount);
  }
  return funds;
}

function reducerFunds(snapshot: TranscriptSnapshot<Payload>, connected: string[]): Map<string, number> {
  const events = transcriptToReducerEvents(snapshot as any);
  return reduceTexasHoldem(events, new Map(), connected).funds;
}

function runVerifierFull(snapshot: TranscriptSnapshot<Payload>): any {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-host-"));
  tempDirs.push(dir);
  const file = path.join(dir, "transcript.json");
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
  return JSON.parse(execFileSync(process.execPath, [verifierPath, file], { encoding: "utf8" }));
}

function expectSameFunds(a: Map<string, number>, b: Map<string, number>, label: string) {
  const norm = (m: Map<string, number>) => Array.from(m.entries()).sort();
  expect({ label, funds: norm(a) }).toEqual({ label, funds: norm(b) });
}

describe("offline verifier ⇄ live reducer chip-outcome parity (fold-out hands)", () => {
  jest.setTimeout(60000);

  const scenarios: Array<{ name: string; actions: Action[] }> = [
    { name: "SB folds preflop", actions: [{ by: 'alice', fold: true }] },
    { name: "SB calls, BB folds", actions: [{ by: 'alice', bet: 1 }, { by: 'bob', fold: true }] },
    { name: "SB raises, BB folds", actions: [{ by: 'alice', bet: 9 }, { by: 'bob', fold: true }] },
    { name: "SB raises, BB re-raises, SB folds", actions: [{ by: 'alice', bet: 9 }, { by: 'bob', bet: 18 }, { by: 'alice', fold: true }] },
  ];

  for (const { name, actions } of scenarios) {
    test(`verifier funds == reducer funds — ${name}`, async () => {
      const { snapshot, alice, bob } = await buildFoldOutTranscript(actions);
      const fromVerifier = runVerifierFinalFunds(snapshot);
      const fromReducer = reducerFunds(snapshot, [alice, bob]);
      expectSameFunds(fromVerifier, fromReducer, name);
    });
  }
});

async function appendPublicDecrypts(recorder: TranscriptRecorder<Payload>, alice: EventSigner, bob: EventSigner, round: number, offsets: number[]): Promise<void> {
  const decryptionKey = { d: '1', n: '10007' }; // identity on encoded card values ≤ 53^2 = 2809 (Audit R4-11)
  for (const cardOffset of offsets) {
    await appendSigned(recorder, alice, { type: 'card/decrypt', round, cardOffset, aliceOrBob: 'alice', decryptionKey });
    await appendSigned(recorder, bob, { type: 'card/decrypt', round, cardOffset, aliceOrBob: 'bob', decryptionKey });
  }
}

describe("R2.07 host-authority detection (verifier flags non-host control events)", () => {
  jest.setTimeout(60000);

  test("a non-host updateSettings / openRegistration is flagged in the verifiable record", async () => {
    const { alice, bob } = await twoSigners();
    const recorder = new TranscriptRecorder<Payload>();
    const aId = alice.identity.peerId, bId = bob.identity.peerId;
    await appendFinalizedDeck(recorder, alice, bob);
    // alice starts hand 1 → alice is the established host.
    await appendSigned(recorder, alice, { type: "newRound", round: 1, players: [aId, bId], settings: { initialFundAmount: 100 } });
    // bob (NOT the host) tries to change settings and reopen registration.
    await appendSigned(recorder, bob, { type: "action/updateSettings", round: 1, settings: { initialFundAmount: 100, smallBlindAmount: 50 } });
    await appendSigned(recorder, bob, { type: "action/openRegistration", round: 1 });
    await appendSigned(recorder, alice, { type: "action/fold", round: 1 });

    const result = runVerifierFull(recorder.snapshot());
    const warningText = JSON.stringify(result.gameProtocol.warnings ?? []);
    expect(warningText).toContain("updateSettings by non-host");
    expect(warningText).toContain("openRegistration by non-host");
    // The host (alice) doing the same is NOT flagged.
    const ok = await buildFoldOutTranscript([{ by: 'alice', fold: true }]);
    const cleanResult = runVerifierFull(ok.snapshot);
    expect(JSON.stringify(cleanResult.gameProtocol.warnings ?? [])).not.toContain("non-host");
  });
});

describe("offline verifier ⇄ live reducer chip-outcome parity (showdown / side-pot path)", () => {
  jest.setTimeout(60000);

  test("verifier funds == reducer funds — heads-up showdown, pair of aces beats K-Q", async () => {
    // Board: 2h 7d 9c Js 4d; alice holes Ah Ad (pair of aces), bob holes Ks Qs.
    const codes: Record<number, number> = { 0: 2, 1: 20, 2: 35, 3: 50, 4: 17, 5: 1, 6: 14, 7: 52, 8: 51 };
    const { alice, bob } = await twoSigners();
    const recorder = new TranscriptRecorder<Payload>();
    const aId = alice.identity.peerId, bId = bob.identity.peerId;

    // Finalized PLAINTEXT deck (the verifier decodes it; the decrypt below is identity).
    await appendSigned(recorder, alice, { type: "start", round: 1, mentalPokerSettings: { alice: aId, bob: bId } });
    await appendSigned(recorder, alice, { type: "deck/step1", round: 1, deck: makeDeck("a-enc"), publicKey: { p: "a-p", q: "a-q" } });
    await appendSigned(recorder, bob, { type: "deck/step2", round: 1, deck: makeDeck("b-enc") });
    await appendSigned(recorder, alice, { type: "deck/step3", round: 1, deck: makeDeck("a-rm") });
    await appendSigned(recorder, bob, { type: "deck/finalized", round: 1, deck: makePlainFinalDeck(codes) });
    await appendSigned(recorder, alice, { type: "newRound", round: 1, players: [aId, bId], settings: { initialFundAmount: 100, smallBlindAmount: 1, bigBlindAmount: 2 } });
    // SB completes, BB checks → flop; check the whole way to a river showdown.
    await appendSigned(recorder, alice, { type: "action/bet", round: 1, amount: 1 });
    await appendSigned(recorder, bob, { type: "action/bet", round: 1, amount: 0 });
    await appendPublicDecrypts(recorder, alice, bob, 1, [0, 1, 2]);
    await appendSigned(recorder, alice, { type: "action/bet", round: 1, amount: 0 });
    await appendSigned(recorder, bob, { type: "action/bet", round: 1, amount: 0 });
    await appendPublicDecrypts(recorder, alice, bob, 1, [3]);
    await appendSigned(recorder, alice, { type: "action/bet", round: 1, amount: 0 });
    await appendSigned(recorder, bob, { type: "action/bet", round: 1, amount: 0 });
    await appendPublicDecrypts(recorder, alice, bob, 1, [4]);
    await appendSigned(recorder, alice, { type: "action/bet", round: 1, amount: 0 });
    await appendSigned(recorder, bob, { type: "action/bet", round: 1, amount: 0 });
    await appendPublicDecrypts(recorder, alice, bob, 1, [5, 6, 7, 8]);

    const snapshot = recorder.snapshot();
    const fromVerifier = runVerifierFinalFunds(snapshot);

    // Feed the reducer the SAME decoded cards as reveals (board 0-4, holes 5-8).
    const reveals: CardReveals = new Map([[1, new Map<number, StandardCard>(
      Object.entries(codes).map(([offset, code]) => [Number(offset), decodeCode(code)]),
    )]]);
    const events = transcriptToReducerEvents(snapshot as any);
    const fromReducer = reduceTexasHoldem(events, reveals, [aId, bId]).funds;

    expectSameFunds(fromVerifier, fromReducer, "showdown AA vs KQ");
    // Sanity: alice (AA) wins the 4-chip pot → 102 / 98.
    expect(fromReducer.get(aId)).toBe(102);
    expect(fromReducer.get(bId)).toBe(98);
  });
});
