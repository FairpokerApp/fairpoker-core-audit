import {execFileSync} from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {createEventSigner, EventSigner, generateSigningIdentity} from "./eventSigning";
import {TranscriptRecorder, TranscriptSnapshot} from "./transcript";
import {canonicalHandHash} from "./handConsensus";

type GameEventPayload = Record<string, unknown>;

interface CliProtocolIssue {
  index: number | null;
  message: string;
}

interface CliRoundReport {
  round: number;
  mentalPoker: {
    start: boolean;
    deckStep1: boolean;
    deckStep2: boolean;
    deckStep3: boolean;
    participants: string[];
    shuffles: number[];
    locks: number[];
    finalized: boolean;
  };
  texasHoldem: {
    newRound: boolean;
    bets: number;
    folds: number;
    potTotal: number;
    endedByFold: boolean;
    derivedResult: null | {
      how: 'LastOneWins' | 'Showdown';
      winner?: string;
      board?: string[];
      showdown?: Array<{
        players: string[];
        handName: string;
      }>;
    };
    awards: Array<{
      player: string;
      amount: number;
    }>;
    finalFunds: Array<{
      player: string;
      amount: number;
    }>;
  };
}

interface CliResult {
  ok: boolean;
  reason?: string;
  entries?: number;
  signedEvents?: number;
  unsignedEvents?: number;
  eventTypes?: Record<string, number>;
  gameProtocol: {
    ok: boolean;
    errors: CliProtocolIssue[];
    warnings: CliProtocolIssue[];
    rounds: CliRoundReport[];
  };
}

const appRoot = path.resolve(__dirname, '../../..');
const verifierPath = path.join(appRoot, 'scripts/verify-transcript.js');
const tempDirs: string[] = [];

afterAll(() => {
  for (const tempDir of tempDirs) {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
});

function makeDeck(prefix: string): string[] {
  return Array.from({length: 52}, (_, index) => `${prefix}-${index}`);
}

function makePlainFinalDeck(codesByOffset: Record<number, number>): string[] {
  // codesByOffset are 1..52 card indices; the real deck stores each as (index+1)^2 (the encoding
  // the client and verifier use — Audit R4-11), so encode here too. (Without this the test would
  // feed the OLD raw 1..52 values and silently diverge from the real client. Audit R4-12.)
  const enc = (code: number) => String((code + 1) * (code + 1));
  const usedCodes = new Set(Object.values(codesByOffset));
  const remainingCodes = Array.from({length: 52}, (_, index) => index + 1)
    .filter(code => !usedCodes.has(code));
  return Array.from({length: 52}, (_, offset) => {
    const explicitCode = codesByOffset[offset];
    return enc(explicitCode ?? remainingCodes.shift()!);
  });
}

async function createPlayerSigners(): Promise<{
  alice: EventSigner;
  bob: EventSigner;
}> {
  const [aliceIdentity, bobIdentity] = await Promise.all([
    generateSigningIdentity(),
    generateSigningIdentity(),
  ]);
  const [alice, bob] = await Promise.all([
    createEventSigner(aliceIdentity),
    createEventSigner(bobIdentity),
  ]);
  return {alice, bob};
}

async function createThreePlayerSigners(): Promise<{
  alice: EventSigner;
  bob: EventSigner;
  carol: EventSigner;
}> {
  const [aliceIdentity, bobIdentity, carolIdentity] = await Promise.all([
    generateSigningIdentity(),
    generateSigningIdentity(),
    generateSigningIdentity(),
  ]);
  const [alice, bob, carol] = await Promise.all([
    createEventSigner(aliceIdentity),
    createEventSigner(bobIdentity),
    createEventSigner(carolIdentity),
  ]);
  return {alice, bob, carol};
}

async function appendSigned(
  recorder: TranscriptRecorder<GameEventPayload>,
  signer: EventSigner,
  payload: GameEventPayload,
): Promise<void> {
  const signed = await signer.sign({
    sender: signer.identity.peerId,
    scope: 'public',
    payload,
  });

  await recorder.append({
    transportSender: signer.identity.peerId,
    scope: 'public',
    wireEvent: signed,
  });
}

async function appendFinalizedDeck(
  recorder: TranscriptRecorder<GameEventPayload>,
  alice: EventSigner,
  bob: EventSigner,
  finalizedDeck: string[] = makeDeck('final'),
): Promise<void> {
  const round = 1;
  const mentalPokerSettings = {
    alice: alice.identity.peerId,
    bob: bob.identity.peerId,
  };

  await appendSigned(recorder, alice, {
    type: 'start',
    round,
    mentalPokerSettings,
  });
  await appendSigned(recorder, alice, {
    type: 'deck/step1',
    round,
    deck: makeDeck('alice-encrypted'),
    publicKey: {p: 'alice-p', q: 'alice-q'},
  });
  await appendSigned(recorder, bob, {
    type: 'deck/step2',
    round,
    deck: makeDeck('bob-encrypted'),
  });
  await appendSigned(recorder, alice, {
    type: 'deck/step3',
    round,
    deck: makeDeck('alice-removed'),
  });
  await appendSigned(recorder, bob, {
    type: 'deck/finalized',
    round,
    deck: finalizedDeck,
  });
}

async function appendMultiPartyFinalizedDeck(
  recorder: TranscriptRecorder<GameEventPayload>,
  players: EventSigner[],
  finalizedDeck: string[] = makeDeck('final'),
): Promise<void> {
  const round = 1;
  const participants = players.map(player => player.identity.peerId);

  await appendSigned(recorder, players[0], {
    type: 'start',
    round,
    mentalPokerSettings: {
      participants,
    },
  });
  for (let shuffleIndex = 0; shuffleIndex < players.length; shuffleIndex += 1) {
    await appendSigned(recorder, players[shuffleIndex], {
      type: 'deck/shuffle',
      round,
      player: participants[shuffleIndex],
      shuffleIndex,
      deck: makeDeck(`shuffle-${shuffleIndex}`),
      ...(shuffleIndex === 0 ? { publicKey: {p: 'p', q: 'q'} } : {}),
    });
  }
  for (let lockIndex = 0; lockIndex < players.length; lockIndex += 1) {
    await appendSigned(recorder, players[lockIndex], {
      type: 'deck/lock',
      round,
      player: participants[lockIndex],
      lockIndex,
      deck: lockIndex === players.length - 1 ? finalizedDeck : makeDeck(`lock-${lockIndex}`),
    });
  }
  await appendSigned(recorder, players[players.length - 1], {
    type: 'deck/finalized',
    round,
    player: participants[participants.length - 1],
    deck: finalizedDeck,
  });
}

async function appendPublicDecrypts(
  recorder: TranscriptRecorder<GameEventPayload>,
  alice: EventSigner,
  bob: EventSigner,
  round: number,
  offsets: number[],
): Promise<void> {
  const decryptionKey = {d: '1', n: '10007'}; // identity on encoded card values ≤ 53^2 = 2809 (Audit R4-11)
  for (const cardOffset of offsets) {
    await appendSigned(recorder, alice, {
      type: 'card/decrypt',
      round,
      cardOffset,
      aliceOrBob: 'alice',
      decryptionKey,
    });
    await appendSigned(recorder, bob, {
      type: 'card/decrypt',
      round,
      cardOffset,
      aliceOrBob: 'bob',
      decryptionKey,
    });
  }
}

async function createValidTranscript(): Promise<TranscriptSnapshot<GameEventPayload>> {
  const {alice, bob} = await createPlayerSigners();
  const recorder = new TranscriptRecorder<GameEventPayload>();

  await appendFinalizedDeck(recorder, alice, bob);
  await appendSigned(recorder, alice, {
    type: 'newRound',
    round: 1,
    players: [alice.identity.peerId, bob.identity.peerId],
    settings: {
      initialFundAmount: 100,
    },
  });
  await appendSigned(recorder, alice, {
    type: 'action/bet',
    round: 1,
    amount: 1,
  });
  await appendSigned(recorder, bob, {
    type: 'action/bet',
    round: 1,
    amount: 0,
  });
  await appendSigned(recorder, bob, {
    type: 'action/fold',
    round: 1,
  });

  return recorder.snapshot();
}

const SHOWDOWN_CODES_BY_OFFSET = {
  0: 2,   // 2h
  1: 20,  // 7d
  2: 35,  // 9c
  3: 50,  // Js
  4: 17,  // 4d
  5: 1,   // Ah
  6: 14,  // Ad
  7: 52,  // Ks
  8: 51,  // Qs
};

async function createShowdownTranscript(finalizedDeck = makePlainFinalDeck(SHOWDOWN_CODES_BY_OFFSET)): Promise<{
  transcript: TranscriptSnapshot<GameEventPayload>;
  alice: string;
  bob: string;
}> {
  const {alice, bob} = await createPlayerSigners();
  const recorder = new TranscriptRecorder<GameEventPayload>();

  await appendFinalizedDeck(recorder, alice, bob, finalizedDeck);
  await appendSigned(recorder, alice, {
    type: 'newRound',
    round: 1,
    players: [alice.identity.peerId, bob.identity.peerId],
    settings: {
      initialFundAmount: 100,
    },
  });

  await appendSigned(recorder, alice, {type: 'action/bet', round: 1, amount: 1});
  await appendSigned(recorder, bob, {type: 'action/bet', round: 1, amount: 0});
  await appendPublicDecrypts(recorder, alice, bob, 1, [0, 1, 2]);

  await appendSigned(recorder, alice, {type: 'action/bet', round: 1, amount: 0});
  await appendSigned(recorder, bob, {type: 'action/bet', round: 1, amount: 0});
  await appendPublicDecrypts(recorder, alice, bob, 1, [3]);

  await appendSigned(recorder, alice, {type: 'action/bet', round: 1, amount: 0});
  await appendSigned(recorder, bob, {type: 'action/bet', round: 1, amount: 0});
  await appendPublicDecrypts(recorder, alice, bob, 1, [4]);

  await appendSigned(recorder, alice, {type: 'action/bet', round: 1, amount: 0});
  await appendSigned(recorder, bob, {type: 'action/bet', round: 1, amount: 0});
  await appendPublicDecrypts(recorder, alice, bob, 1, [5, 6, 7, 8]);

  return {
    transcript: recorder.snapshot(),
    alice: alice.identity.peerId,
    bob: bob.identity.peerId,
  };
}

function writeTranscript(transcript: TranscriptSnapshot<GameEventPayload>): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fairpoker-transcript-'));
  tempDirs.push(tempDir);
  const transcriptPath = path.join(tempDir, 'transcript.json');
  fs.writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2));
  return transcriptPath;
}

function runVerifier(transcriptPath: string): CliResult {
  const stdout = execFileSync(process.execPath, [verifierPath, transcriptPath], {
    cwd: appRoot,
    encoding: 'utf8',
  });
  return JSON.parse(stdout) as CliResult;
}

function runVerifierExpectingFailure(transcriptPath: string): CliResult {
  try {
    runVerifier(transcriptPath);
    throw new Error('Expected transcript verifier to fail');
  } catch (error) {
    const stdout = (error as {stdout?: Buffer | string}).stdout;
    if (!stdout) throw error;
    return JSON.parse(stdout.toString()) as CliResult;
  }
}

describe('transcript verifier CLI', () => {
  test('accepts a signed transcript with finalized deck and table actions', async () => {
    const result = runVerifier(writeTranscript(await createValidTranscript()));

    expect(result).toMatchObject({
      ok: true,
      entries: 9,
      signedEvents: 9,
      unsignedEvents: 0,
      eventTypes: {
        start: 1,
        'deck/finalized': 1,
        newRound: 1,
        'action/bet': 2,
        'action/fold': 1,
      },
      gameProtocol: {
        ok: true,
        errors: [],
        warnings: [],
      },
    });
    expect(result.gameProtocol.rounds[0]).toMatchObject({
      round: 1,
      mentalPoker: {
        start: true,
        deckStep1: true,
        deckStep2: true,
        deckStep3: true,
        finalized: true,
      },
      texasHoldem: {
        newRound: true,
        bets: 2,
        folds: 1,
        potTotal: 4,
        endedByFold: true,
      },
    });
  });

  test('exposes a canonical hand hash matching the live handConsensus value', async () => {
    const transcript = await createValidTranscript();
    const result = runVerifier(writeTranscript(transcript));
    const round1 = result.gameProtocol.rounds.find(r => r.round === 1);
    expect(round1).toBeDefined();
    const handHash = (round1 as unknown as {canonicalHandHash: string}).canonicalHandHash;
    expect(handHash).toMatch(/^sha256:[0-9a-f]+$/);
    // The offline verifier and a live client must compute the SAME hand hash, so
    // two players can compare their records of the hand. (Audit D05.)
    expect(handHash).toBe(await canonicalHandHash(transcript.entries, 1));
  });

  test('replays action/autoFold as a fold of the target player', async () => {
    const {alice, bob} = await createPlayerSigners();
    const recorder = new TranscriptRecorder<GameEventPayload>();

    await appendFinalizedDeck(recorder, alice, bob);
    await appendSigned(recorder, alice, {
      type: 'newRound',
      round: 1,
      players: [alice.identity.peerId, bob.identity.peerId],
      settings: {initialFundAmount: 100},
    });
    await appendSigned(recorder, alice, {type: 'action/bet', round: 1, amount: 1});
    await appendSigned(recorder, bob, {type: 'action/bet', round: 1, amount: 0});
    // Any client may broadcast an auto-fold; here alice's client reports bob timed out.
    await appendSigned(recorder, alice, {
      type: 'action/autoFold',
      round: 1,
      target: bob.identity.peerId,
    });

    const result = runVerifier(writeTranscript(recorder.snapshot()));

    expect(result.gameProtocol.ok).toBe(true);
    expect(result.gameProtocol.rounds[0].texasHoldem).toMatchObject({
      autoFolds: 1,
      folds: 1,
      endedByFold: true,
    });
  });

  test('rejects action/autoFold targeting a non-participant', async () => {
    const {alice, bob} = await createPlayerSigners();
    const recorder = new TranscriptRecorder<GameEventPayload>();

    await appendFinalizedDeck(recorder, alice, bob);
    await appendSigned(recorder, alice, {
      type: 'newRound',
      round: 1,
      players: [alice.identity.peerId, bob.identity.peerId],
      settings: {initialFundAmount: 100},
    });
    await appendSigned(recorder, alice, {
      type: 'action/autoFold',
      round: 1,
      target: 'ghost-player',
    });

    const result = runVerifierExpectingFailure(writeTranscript(recorder.snapshot()));

    expect(result.ok).toBe(false);
    expect(result.gameProtocol.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: 'AutoFold target ghost-player is not in round 1',
      }),
    ]));
  });

  test('accepts a signed transcript where every participant shuffles and locks', async () => {
    const {alice, bob, carol} = await createThreePlayerSigners();
    const players = [alice, bob, carol];
    const playerIds = players.map(player => player.identity.peerId);
    const recorder = new TranscriptRecorder<GameEventPayload>();

    await appendMultiPartyFinalizedDeck(recorder, players);
    await appendSigned(recorder, alice, {
      type: 'newRound',
      round: 1,
      players: playerIds,
      settings: {
        initialFundAmount: 100,
      },
    });

    const result = runVerifier(writeTranscript(recorder.snapshot()));

    expect(result.ok).toBe(true);
    expect(result.gameProtocol.rounds[0].mentalPoker).toMatchObject({
      participants: playerIds,
      shuffles: [0, 1, 2],
      locks: [0, 1, 2],
      finalized: true,
    });
  });

  test('derives showdown winners, awards, and final funds from public reveal data', async () => {
    const {transcript, alice, bob} = await createShowdownTranscript();
    const result = runVerifier(writeTranscript(transcript));

    expect(result.ok).toBe(true);
    expect(result.gameProtocol.rounds[0].texasHoldem).toMatchObject({
      potTotal: 4,
      derivedResult: {
        how: 'Showdown',
        board: ['2h', '7d', '9c', 'Js', '4d'],
        showdown: [
          {
            players: [alice],
            handName: 'One Pair',
          },
          {
            players: [bob],
            handName: 'High Card',
          },
        ],
      },
      awards: [
        {
          player: alice,
          amount: 4,
        },
      ],
    });
    expect(result.gameProtocol.rounds[0].texasHoldem.finalFunds).toEqual(expect.arrayContaining([
      {player: alice, amount: 102},
      {player: bob, amount: 98},
    ]));
  });

  test('splits the pot when public showdown hands tie', async () => {
    const {transcript, alice, bob} = await createShowdownTranscript(makePlainFinalDeck({
      0: 1,   // Ah
      1: 13,  // Kh
      2: 12,  // Qh
      3: 11,  // Jh
      4: 10,  // Th
      5: 2,
      6: 15,
      7: 28,
      8: 41,
    }));

    const result = runVerifier(writeTranscript(transcript));

    expect(result.ok).toBe(true);
    expect(result.gameProtocol.rounds[0].texasHoldem.derivedResult).toMatchObject({
      how: 'Showdown',
      board: ['Ah', 'Kh', 'Qh', 'Jh', 'Th'],
      showdown: [
        {
          players: [alice, bob],
          handName: 'Straight Flush',
        },
      ],
    });
    expect(result.gameProtocol.rounds[0].texasHoldem.awards).toEqual(expect.arrayContaining([
      {player: alice, amount: 2},
      {player: bob, amount: 2},
    ]));
    expect(result.gameProtocol.rounds[0].texasHoldem.finalFunds).toEqual(expect.arrayContaining([
      {player: alice, amount: 100},
      {player: bob, amount: 100},
    ]));
  });

  test('rejects unsigned entries even when the hash chain is intact', async () => {
    const recorder = new TranscriptRecorder<GameEventPayload>();
    await recorder.append({
      transportSender: 'peer-a',
      scope: 'public',
      wireEvent: {
        type: 'newRound',
        round: 1,
        players: ['peer-a', 'peer-b'],
        settings: {
          initialFundAmount: 100,
        },
      },
    });

    const result = runVerifierExpectingFailure(writeTranscript(recorder.snapshot()));

    expect(result.ok).toBe(false);
    expect(result.gameProtocol.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: 'Unsigned event is not allowed in Fair Poker v0 transcripts',
      }),
    ]));
  });

  test('rejects table play before the mental-poker deck is finalized', async () => {
    const {alice, bob} = await createPlayerSigners();
    const recorder = new TranscriptRecorder<GameEventPayload>();

    await appendSigned(recorder, alice, {
      type: 'newRound',
      round: 1,
      players: [alice.identity.peerId, bob.identity.peerId],
      settings: {
        initialFundAmount: 100,
      },
    });

    const result = runVerifierExpectingFailure(writeTranscript(recorder.snapshot()));

    expect(result.ok).toBe(false);
    expect(result.gameProtocol.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: 'Round 1 newRound happened before deck finalization',
      }),
      expect.objectContaining({
        message: 'Round 1 has table play without finalized deck',
      }),
    ]));
  });

  test('rejects out-of-order mental-poker deck steps', async () => {
    const {alice, bob} = await createPlayerSigners();
    const recorder = new TranscriptRecorder<GameEventPayload>();

    await appendSigned(recorder, alice, {
      type: 'start',
      round: 1,
      mentalPokerSettings: {
        alice: alice.identity.peerId,
        bob: bob.identity.peerId,
      },
    });
    await appendSigned(recorder, bob, {
      type: 'deck/step2',
      round: 1,
      deck: makeDeck('bob-too-early'),
    });

    const result = runVerifierExpectingFailure(writeTranscript(recorder.snapshot()));

    expect(result.ok).toBe(false);
    expect(result.gameProtocol.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: 'Round 1 deck/step2 happened before deck/step1',
      }),
    ]));
  });

  test('rejects a finalized deck with duplicated ciphertexts', async () => {
    const duplicatedDeck = makePlainFinalDeck(SHOWDOWN_CODES_BY_OFFSET);
    duplicatedDeck[8] = duplicatedDeck[5];
    const {transcript} = await createShowdownTranscript(duplicatedDeck);

    const result = runVerifierExpectingFailure(writeTranscript(transcript));

    expect(result.ok).toBe(false);
    expect(result.gameProtocol.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: 'Round 1 finalized deck contains duplicate ciphertexts',
      }),
    ]));
  });

  test('rejects an under-bet that does not reach the call amount', async () => {
    const {alice, bob} = await createPlayerSigners();
    const recorder = new TranscriptRecorder<GameEventPayload>();
    await appendFinalizedDeck(recorder, alice, bob);
    await appendSigned(recorder, alice, {
      type: 'newRound',
      round: 1,
      players: [alice.identity.peerId, bob.identity.peerId],
      settings: {initialFundAmount: 100},
    });
    // alice is the small blind (total 1); betting 0 leaves her total at 1, below
    // the big blind's 2, and is not an all-in — an illegal under-call. (D03)
    await appendSigned(recorder, alice, {type: 'action/bet', round: 1, amount: 0});

    const result = runVerifierExpectingFailure(writeTranscript(recorder.snapshot()));
    expect(result.ok).toBe(false);
    expect(result.gameProtocol.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({message: expect.stringContaining('below the call amount')}),
    ]));
  });
});
