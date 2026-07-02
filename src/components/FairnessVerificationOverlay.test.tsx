import React from "react";
import {render, screen, waitFor, cleanup} from "@testing-library/react";
import {SIGNED_EVENT_KIND} from "../lib/fairness/eventSigning";

const transcriptRef: {entries: Array<{scope: 'public' | 'private'; wireEvent: unknown}>; throwErr?: boolean} = {entries: []};

jest.mock("../lib/setup", () => ({
  TexasHoldem: {
    getTranscript: () => {
      if (transcriptRef.throwErr) {
        throw new Error('transcript unavailable mid-reconnect');
      }
      return {entries: transcriptRef.entries};
    },
    listener: {on: () => undefined, off: () => undefined},
  },
}));

import FairnessVerificationOverlay from "./FairnessVerificationOverlay";

const PLAYERS = ['a', 'b', 'c', 'd', 'e'];

function signed(payload: object): {scope: 'public'; wireEvent: unknown} {
  return {scope: 'public', wireEvent: {kind: SIGNED_EVENT_KIND, payload, signature: `sig-${Math.random()}`}};
}

function deck(unique = true): string[] {
  const cards = Array.from({length: 52}, (_, i) => `ciphertext-${i}`);
  if (!unique) {
    cards[51] = cards[0];
  }
  return cards;
}

function cleanHand(opts: {unique?: boolean} = {}) {
  const entries: Array<{scope: 'public' | 'private'; wireEvent: unknown}> = [];
  PLAYERS.forEach((player, i) => entries.push(signed({type: 'deck/shuffle', round: 1, player, shuffleIndex: i})));
  PLAYERS.forEach((player, i) => entries.push(signed({type: 'deck/lock', round: 1, player, lockIndex: i})));
  entries.push(signed({type: 'deck/finalized', round: 1, player: PLAYERS[4], deck: deck(opts.unique ?? true)}));
  return entries;
}

afterEach(cleanup);

test('plays the scan then lands on a pass verdict for a clean hand', async () => {
  transcriptRef.entries = cleanHand();
  render(<FairnessVerificationOverlay visible round={1} participants={PLAYERS}/>);
  // Starts in the scanning state.
  expect(screen.getByTestId('fairness-overlay').getAttribute('data-status')).toBe('scanning');
  await waitFor(
    () => expect(screen.getByTestId('fairness-overlay').getAttribute('data-status')).toBe('pass'),
    {timeout: 5000},
  );
  expect(screen.getByTestId('fairness-check-deckIntegrity').getAttribute('data-check-status')).toBe('pass');
});

test('lands on a warn verdict and flags the deck check for a forged (duplicate) deck', async () => {
  transcriptRef.entries = cleanHand({unique: false});
  render(<FairnessVerificationOverlay visible round={1} participants={PLAYERS}/>);
  await waitFor(
    () => expect(screen.getByTestId('fairness-overlay').getAttribute('data-status')).toBe('warn'),
    {timeout: 5000},
  );
  expect(screen.getByTestId('fairness-check-deckIntegrity').getAttribute('data-check-status')).toBe('warn');
});

test('renders nothing when not visible', () => {
  transcriptRef.entries = cleanHand();
  render(<FairnessVerificationOverlay visible={false} round={1} participants={PLAYERS}/>);
  expect(screen.queryByTestId('fairness-overlay')).toBeNull();
});

test('a throwing getTranscript (mid-reconnect refresh) never strands the spinner — it lands on a verdict', async () => {
  // Repro of the live "in-hand refresh → fairness check spins forever" bug: a transcript
  // snapshot captured mid-reconnect can throw. The effect must degrade gracefully (try/catch
  // → no entries) and still reach a verdict instead of being stuck on "校验中…".
  transcriptRef.entries = cleanHand();
  transcriptRef.throwErr = true;
  try {
    render(<FairnessVerificationOverlay visible round={1} participants={PLAYERS}/>);
    await waitFor(
      () => expect(screen.getByTestId('fairness-overlay').getAttribute('data-status')).not.toBe('scanning'),
      {timeout: 5000},
    );
  } finally {
    transcriptRef.throwErr = false;
  }
});
