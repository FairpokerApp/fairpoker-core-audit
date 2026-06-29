#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const { evaluateCards, handRank, rankDescription } = require('phe');

const SIGNED_EVENT_KIND = 'fairpoker.signed-event.v1';
const GENESIS_TRANSCRIPT_HASH = 'sha256:genesis';

function normalize(value) {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(normalize);
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;
  if (type === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot canonicalize non-finite number: ${value}`);
    }
    return value;
  }
  if (type === 'undefined') return undefined;
  if (type === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      const normalized = normalize(value[key]);
      if (typeof normalized !== 'undefined') {
        output[key] = normalized;
      }
    }
    return output;
  }
  throw new Error(`Cannot canonicalize value of type ${type}`);
}

function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function base64UrlToBytes(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - input.length % 4) % 4);
  return Buffer.from(padded, 'base64');
}

function bytesToBase64Url(bytes) {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function modPow(base, exponent, modulus) {
  if (modulus <= 0n) {
    throw new Error('Modulus must be positive');
  }
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e % 2n === 1n) {
      result = (result * b) % modulus;
    }
    e = e / 2n;
    b = (b * b) % modulus;
  }
  return result;
}

function decryptWithKey(cipher, key) {
  return modPow(cipher, BigInt(key.d), BigInt(key.n));
}

const SUIT_DECODING = {
  1: 'Heart',
  2: 'Diamond',
  3: 'Club',
  4: 'Spade',
};

const RANK_DECODING = {
  1: 'A',
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: 'T',
  11: 'J',
  12: 'Q',
  13: 'K',
};

const SUIT_TO_PHE = {
  Heart: 'h',
  Diamond: 'd',
  Club: 'c',
  Spade: 's',
};

function decodeStandardCard(value) {
  if (!Number.isInteger(value) || value < 1 || value > 52) {
    throw new Error(`Decoded card must be an integer from 1 to 52, got ${value}`);
  }
  let rankCode = value % 13;
  if (rankCode === 0) rankCode = 13;
  const suitCode = Math.floor((value - 1) / 13) + 1;
  return {
    suit: SUIT_DECODING[suitCode],
    rank: RANK_DECODING[rankCode],
  };
}

function toPheCard(card) {
  return `${card.rank}${SUIT_TO_PHE[card.suit]}`;
}

function mapToSortedEntries(map) {
  return Array.from(map.entries())
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([player, amount]) => ({ player, amount }));
}

function isSignedGameEvent(value) {
  return !!value && typeof value === 'object' && value.kind === SIGNED_EVENT_KIND;
}

function payloadOf(wireEvent) {
  return isSignedGameEvent(wireEvent) ? wireEvent.payload : wireEvent;
}

function senderOf(entry) {
  return isSignedGameEvent(entry.wireEvent) ? entry.wireEvent.sender : entry.transportSender;
}

function isStringArrayOfLength(value, length) {
  return Array.isArray(value)
    && value.length === length
    && value.every(item => typeof item === 'string' && item.length > 0);
}

function hasDuplicateStrings(values) {
  return Array.isArray(values) && new Set(values).size !== values.length;
}

function participantsFromSettings(settings) {
  const participants = [];
  const add = (participant) => {
    if (typeof participant === 'string' && participant && !participants.includes(participant)) {
      participants.push(participant);
    }
  };
  if (Array.isArray(settings?.participants)) {
    settings.participants.forEach(add);
    return participants;
  }
  add(settings?.alice);
  add(settings?.bob);
  return participants;
}

function createRoundAnalysis(round) {
  return {
    round,
    mentalPoker: {
      start: false,
      deckStep1: false,
      deckStep2: false,
      deckStep3: false,
      participants: [],
      shuffles: [],
      locks: [],
      finalized: false,
      decryptEvents: 0,
      publicDecryptEvents: 0,
      privateDecryptEvents: 0,
    },
    texasHoldem: {
      newRound: false,
      players: [],
      bets: 0,
      folds: 0,
      autoFolds: 0,
      voidVotes: 0,
      potTotal: 0,
      endedByFold: false,
      derivedResult: null,
      awards: [],
      finalFunds: [],
    },
  };
}

function ensureRound(map, round) {
  if (!map.has(round)) {
    map.set(round, createRoundAnalysis(round));
  }
  return map.get(round);
}

function addError(errors, index, message) {
  errors.push({ index, message });
}

function addWarning(warnings, index, message) {
  warnings.push({ index, message });
}

function analyzeGameProtocol(transcript) {
  const errors = [];
  const warnings = [];
  const rounds = new Map();
  // R2.07 host-authority (detection, attributable): the table host is the signer of the
  // FIRST newRound (the creator who started hand 1). Control events that change the table
  // for everyone — updateSettings (blinds/settings) and openRegistration (restart) — are
  // expected only from that host; anyone else doing it is flagged in the record. These
  // events can never touch chips or cards (those require each player's own signed bet/fold),
  // so this is a "who may press the table-control buttons" boundary, surfaced as a warning.
  let establishedHost = null;
  // Tracks signed sequence numbers per (sender, sessionNonce) to detect replay
  // and out-of-order signed events. Scoping by sessionNonce means a page reload
  // (fresh signer starting at sequence 1) is a new session, not a false replay.
  const signedSequenceByScope = new Map();
  // Public signed-event signatures per round → canonical hand hash (T1.4/B09/D05).
  const publicSignaturesByRound = new Map();
  const mentalSettingsByRound = new Map();
  const texasStateByRound = new Map();
  const finalizedDeckByRound = new Map();
  const publicDecryptKeysByRound = new Map();
  const globalFunds = new Map();

  function ensurePublicDecryptKeys(round) {
    if (!publicDecryptKeysByRound.has(round)) {
      publicDecryptKeysByRound.set(round, new Map());
    }
    return publicDecryptKeysByRound.get(round);
  }

  function isUsableDecryptionKey(key) {
    if (!key?.d || !key?.n) return false;
    try {
      return BigInt(key.d) >= 0n && BigInt(key.n) > 0n;
    } catch {
      return false;
    }
  }

  function decryptOwnerFromPayload(payload) {
    const settings = mentalSettingsByRound.get(payload.round);
    if (payload.player) return payload.player;
    if (payload.aliceOrBob === 'alice') return settings?.alice;
    if (payload.aliceOrBob === 'bob') return settings?.bob;
    return undefined;
  }

  function recordPublicDecryptKey(entry, payload) {
    if (entry.scope === 'private') return;
    if (!Number.isInteger(payload.cardOffset) || payload.cardOffset < 0 || payload.cardOffset >= 52) return;
    const owner = decryptOwnerFromPayload(payload);
    if (!owner) return;
    if (!isUsableDecryptionKey(payload.decryptionKey)) return;

    const keysForRound = ensurePublicDecryptKeys(payload.round);
    if (!keysForRound.has(payload.cardOffset)) {
      keysForRound.set(payload.cardOffset, {});
    }
    const keysForCard = keysForRound.get(payload.cardOffset);
    if (keysForCard[owner]) {
      addError(errors, entry.index, `Round ${payload.round} has duplicate public ${owner} decrypt key for card ${payload.cardOffset}`);
      return;
    }
    keysForCard[owner] = payload.decryptionKey;
  }

  function decryptPublicCard(roundNo, offset) {
    const deck = finalizedDeckByRound.get(roundNo);
    const keys = publicDecryptKeysByRound.get(roundNo)?.get(offset);
    const participants = participantsFromSettings(mentalSettingsByRound.get(roundNo));
    if (!deck || participants.length === 0 || participants.some(participant => !keys?.[participant])) {
      return null;
    }

    const decrypted = participants.reduce(
      (cipher, participant) => decryptWithKey(cipher, keys[participant]),
      BigInt(deck[offset]),
    );
    const decoded = decodeStandardCard(Number(decrypted));
    return {
      offset,
      encoded: Number(decrypted),
      card: decoded,
      phe: toPheCard(decoded),
    };
  }

  function allPublicCardsAvailable(roundNo, offsets) {
    const participants = participantsFromSettings(mentalSettingsByRound.get(roundNo));
    return participants.length > 0 && offsets.every(offset =>
      participants.every(participant => !!publicDecryptKeysByRound.get(roundNo)?.get(offset)?.[participant])
    );
  }

  function calculateAwards(potInput, showdownResult) {
    const pot = new Map(potInput);
    const awards = new Map();
    for (const result of showdownResult) {
      const winners = [...result.players].sort((p1, p2) => (pot.get(p1) ?? 0) - (pot.get(p2) ?? 0));
      let amountUnallocated = 0;
      for (let winnerOffset = 0; winnerOffset < winners.length; ++winnerOffset) {
        const winner = winners[winnerOffset];
        const betPortion = pot.get(winner) ?? 0;

        for (const [player, betAmount] of Array.from(pot.entries())) {
          const wonAmount = Math.min(betPortion, betAmount);
          amountUnallocated += wonAmount;
          const remaining = betAmount - wonAmount;
          if (remaining === 0) {
            pot.delete(player);
          } else {
            pot.set(player, remaining);
          }
        }

        const wonPortion = Math.floor(amountUnallocated / (winners.length - winnerOffset));
        amountUnallocated -= wonPortion;
        awards.set(winner, (awards.get(winner) ?? 0) + wonPortion);
      }
    }

    for (const [player, remaining] of Array.from(pot.entries())) {
      awards.set(player, (awards.get(player) ?? 0) + remaining);
    }
    for (const [player, amount] of Array.from(awards.entries())) {
      if (amount === 0) {
        awards.delete(player);
      }
    }
    return awards;
  }

  function applyAwards(round, state, result, awards) {
    state.ended = true;
    state.result = result;
    for (const [winner, award] of awards.entries()) {
      const updated = (state.funds.get(winner) ?? 0) + award;
      state.funds.set(winner, updated);
      globalFunds.set(winner, updated);
    }
    round.texasHoldem.derivedResult = result;
    round.texasHoldem.awards = mapToSortedEntries(awards);
    round.texasHoldem.finalFunds = mapToSortedEntries(state.funds);
  }

  function validateMentalPoker(entry) {
    const payload = payloadOf(entry.wireEvent);
    if (!payload || typeof payload.round !== 'number') return;

    const round = ensureRound(rounds, payload.round);
    const sender = senderOf(entry);

    switch (payload.type) {
      case 'start': {
        if (round.mentalPoker.start) {
          addError(errors, entry.index, `Duplicate mental-poker start for round ${payload.round}`);
        }
        round.mentalPoker.start = true;
        mentalSettingsByRound.set(payload.round, payload.mentalPokerSettings);
        round.mentalPoker.participants = participantsFromSettings(payload.mentalPokerSettings);
        if (round.mentalPoker.participants.length === 0) {
          addError(errors, entry.index, `Round ${payload.round} start is missing participants`);
        }
        break;
      }
      case 'deck/shuffle': {
        if (!round.mentalPoker.start) {
          addError(errors, entry.index, `Round ${payload.round} deck/shuffle happened before start`);
        }
        const settings = mentalSettingsByRound.get(payload.round);
        const participants = participantsFromSettings(settings);
        const expectedPlayer = participants[payload.shuffleIndex];
        if (!Number.isInteger(payload.shuffleIndex) || !expectedPlayer) {
          addError(errors, entry.index, `Round ${payload.round} deck/shuffle has invalid shuffle index`);
        } else {
          if (payload.player !== expectedPlayer) {
            addError(errors, entry.index, `Round ${payload.round} deck/shuffle ${payload.shuffleIndex} must be by expected participant`);
          }
          if (sender !== expectedPlayer) {
            addError(errors, entry.index, `Round ${payload.round} deck/shuffle ${payload.shuffleIndex} sent by wrong player`);
          }
          if (round.mentalPoker.shuffles.includes(payload.shuffleIndex)) {
            addError(errors, entry.index, `Duplicate deck/shuffle ${payload.shuffleIndex} for round ${payload.round}`);
          }
          if (payload.shuffleIndex > 0 && !round.mentalPoker.shuffles.includes(payload.shuffleIndex - 1)) {
            addError(errors, entry.index, `Round ${payload.round} deck/shuffle ${payload.shuffleIndex} happened before previous shuffle`);
          }
          round.mentalPoker.shuffles.push(payload.shuffleIndex);
          if (payload.shuffleIndex === 0) round.mentalPoker.deckStep1 = true;
          if (round.mentalPoker.shuffles.length === participants.length) round.mentalPoker.deckStep2 = true;
        }
        if (!isStringArrayOfLength(payload.deck, 52)) {
          addError(errors, entry.index, `Round ${payload.round} deck/shuffle deck must contain 52 encoded cards`);
        }
        if (payload.shuffleIndex === 0 && (!payload.publicKey?.p || !payload.publicKey?.q)) {
          addError(errors, entry.index, `Round ${payload.round} first deck/shuffle is missing public key`);
        }
        break;
      }
      case 'deck/lock': {
        if (!round.mentalPoker.start) {
          addError(errors, entry.index, `Round ${payload.round} deck/lock happened before start`);
        }
        const settings = mentalSettingsByRound.get(payload.round);
        const participants = participantsFromSettings(settings);
        const expectedPlayer = participants[payload.lockIndex];
        if (round.mentalPoker.shuffles.length < participants.length) {
          addError(errors, entry.index, `Round ${payload.round} deck/lock happened before every participant shuffled`);
        }
        if (!Number.isInteger(payload.lockIndex) || !expectedPlayer) {
          addError(errors, entry.index, `Round ${payload.round} deck/lock has invalid lock index`);
        } else {
          if (payload.player !== expectedPlayer) {
            addError(errors, entry.index, `Round ${payload.round} deck/lock ${payload.lockIndex} must be by expected participant`);
          }
          if (sender !== expectedPlayer) {
            addError(errors, entry.index, `Round ${payload.round} deck/lock ${payload.lockIndex} sent by wrong player`);
          }
          if (round.mentalPoker.locks.includes(payload.lockIndex)) {
            addError(errors, entry.index, `Duplicate deck/lock ${payload.lockIndex} for round ${payload.round}`);
          }
          if (payload.lockIndex > 0 && !round.mentalPoker.locks.includes(payload.lockIndex - 1)) {
            addError(errors, entry.index, `Round ${payload.round} deck/lock ${payload.lockIndex} happened before previous lock`);
          }
          round.mentalPoker.locks.push(payload.lockIndex);
          if (round.mentalPoker.locks.length === participants.length) round.mentalPoker.deckStep3 = true;
        }
        if (!isStringArrayOfLength(payload.deck, 52)) {
          addError(errors, entry.index, `Round ${payload.round} deck/lock deck must contain 52 encoded cards`);
        }
        break;
      }
      case 'deck/step1': {
        if (!round.mentalPoker.start) {
          addError(errors, entry.index, `Round ${payload.round} deck/step1 happened before start`);
        }
        if (round.mentalPoker.deckStep1) {
          addError(errors, entry.index, `Duplicate deck/step1 for round ${payload.round}`);
        }
        round.mentalPoker.deckStep1 = true;
        if (!isStringArrayOfLength(payload.deck, 52)) {
          addError(errors, entry.index, `Round ${payload.round} deck/step1 deck must contain 52 encoded cards`);
        }
        if (!payload.publicKey?.p || !payload.publicKey?.q) {
          addError(errors, entry.index, `Round ${payload.round} deck/step1 is missing public key`);
        }
        const settings = mentalSettingsByRound.get(payload.round);
        if (settings?.alice && sender !== settings.alice) {
          addError(errors, entry.index, `Round ${payload.round} deck/step1 sender must be Alice`);
        }
        break;
      }
      case 'deck/step2': {
        if (!round.mentalPoker.deckStep1) {
          addError(errors, entry.index, `Round ${payload.round} deck/step2 happened before deck/step1`);
        }
        if (round.mentalPoker.deckStep2) {
          addError(errors, entry.index, `Duplicate deck/step2 for round ${payload.round}`);
        }
        round.mentalPoker.deckStep2 = true;
        if (!isStringArrayOfLength(payload.deck, 52)) {
          addError(errors, entry.index, `Round ${payload.round} deck/step2 deck must contain 52 encoded cards`);
        }
        const settings = mentalSettingsByRound.get(payload.round);
        if (settings?.bob && sender !== settings.bob) {
          addError(errors, entry.index, `Round ${payload.round} deck/step2 sender must be Bob`);
        }
        break;
      }
      case 'deck/step3': {
        if (!round.mentalPoker.deckStep2) {
          addError(errors, entry.index, `Round ${payload.round} deck/step3 happened before deck/step2`);
        }
        if (round.mentalPoker.deckStep3) {
          addError(errors, entry.index, `Duplicate deck/step3 for round ${payload.round}`);
        }
        round.mentalPoker.deckStep3 = true;
        if (!isStringArrayOfLength(payload.deck, 52)) {
          addError(errors, entry.index, `Round ${payload.round} deck/step3 deck must contain 52 encoded cards`);
        }
        const settings = mentalSettingsByRound.get(payload.round);
        if (settings?.alice && sender !== settings.alice) {
          addError(errors, entry.index, `Round ${payload.round} deck/step3 sender must be Alice`);
        }
        break;
      }
      case 'deck/finalized': {
        const settings = mentalSettingsByRound.get(payload.round);
        const participants = participantsFromSettings(settings);
        const hasNewProtocolEvents = round.mentalPoker.shuffles.length > 0 || round.mentalPoker.locks.length > 0;
        if (hasNewProtocolEvents && round.mentalPoker.locks.length < participants.length) {
          addError(errors, entry.index, `Round ${payload.round} deck/finalized happened before every participant locked`);
        } else if (!hasNewProtocolEvents && !round.mentalPoker.deckStep3) {
          addError(errors, entry.index, `Round ${payload.round} deck/finalized happened before deck/step3`);
        }
        if (round.mentalPoker.finalized) {
          addError(errors, entry.index, `Duplicate deck/finalized for round ${payload.round}`);
        }
        round.mentalPoker.finalized = true;
        if (!isStringArrayOfLength(payload.deck, 52)) {
          addError(errors, entry.index, `Round ${payload.round} finalized deck must contain 52 encoded cards`);
        } else {
          finalizedDeckByRound.set(payload.round, payload.deck);
          if (hasDuplicateStrings(payload.deck)) {
            addError(errors, entry.index, `Round ${payload.round} finalized deck contains duplicate ciphertexts`);
          }
        }
        if (hasNewProtocolEvents) {
          const expectedPlayer = participants[participants.length - 1];
          if (payload.player && payload.player !== expectedPlayer) {
            addError(errors, entry.index, `Round ${payload.round} deck/finalized player must be final participant`);
          }
          if (expectedPlayer && sender !== expectedPlayer) {
            addError(errors, entry.index, `Round ${payload.round} deck/finalized sender must be final participant`);
          }
        } else if (settings?.bob && sender !== settings.bob) {
          addError(errors, entry.index, `Round ${payload.round} deck/finalized sender must be Bob`);
        }
        break;
      }
      case 'card/decrypt': {
        round.mentalPoker.decryptEvents += 1;
        if (entry.scope === 'private') {
          round.mentalPoker.privateDecryptEvents += 1;
        } else {
          round.mentalPoker.publicDecryptEvents += 1;
        }
        if (!Number.isInteger(payload.cardOffset) || payload.cardOffset < 0 || payload.cardOffset >= 52) {
          addError(errors, entry.index, `Round ${payload.round} card/decrypt has invalid card offset`);
        }
        const settings = mentalSettingsByRound.get(payload.round);
        const participants = participantsFromSettings(settings);
        const owner = decryptOwnerFromPayload(payload);
        if (!owner || !participants.includes(owner)) {
          addError(errors, entry.index, `Round ${payload.round} card/decrypt has invalid key owner`);
        }
        // Private hole-card deliveries are now end-to-end sealed to the recipient
        // (audit B03): the verifier sees only ciphertext and cannot — by design —
        // open it. A sealed private key only needs a structural check. Public
        // reveals stay plaintext so the verifier can decrypt and check them.
        const sealedPrivate = entry.scope === 'private'
          && typeof payload.sealedKey === 'string'
          && payload.sealedKey.length > 0;
        if (sealedPrivate) {
          // structurally valid sealed key; nothing further to verify here
        } else if (!payload.decryptionKey?.d || !payload.decryptionKey?.n) {
          addError(errors, entry.index, `Round ${payload.round} card/decrypt is missing key material`);
        } else if (!isUsableDecryptionKey(payload.decryptionKey)) {
          addError(errors, entry.index, `Round ${payload.round} card/decrypt has invalid key material`);
        }
        if (owner && sender !== owner) {
          addError(errors, entry.index, `Round ${payload.round} ${owner} decrypt key sent by wrong player`);
        }
        recordPublicDecryptKey(entry, payload);
        break;
      }
    }
  }

  function initialTexasState(payload) {
    const initialFundAmount = payload.settings?.initialFundAmount ?? 0;
    for (const player of payload.players) {
      const currentFund = globalFunds.get(player);
      if (!currentFund || currentFund < 2) {
        globalFunds.set(player, (currentFund ?? 0) + initialFundAmount);
      }
    }
    const funds = new Map(payload.players.map(player => [player, globalFunds.get(player) ?? 0]));
    const pot = new Map();
    pot.set(payload.players[0], 1);
    pot.set(payload.players[1], 2);
    funds.set(payload.players[0], funds.get(payload.players[0]) - 1);
    funds.set(payload.players[1], funds.get(payload.players[1]) - 2);
    globalFunds.set(payload.players[0], funds.get(payload.players[0]));
    globalFunds.set(payload.players[1], funds.get(payload.players[1]));
    return {
      players: payload.players,
      funds,
      pot,
      folded: new Set(),
      ended: false,
      result: null,
    };
  }

  function deriveLastOneWins(round, state, winner) {
    const totalPotAmount = Array.from(state.pot.values()).reduce((a, b) => a + b, 0);
    const awards = new Map([[winner, totalPotAmount]]);
    applyAwards(round, state, {
      how: 'LastOneWins',
      winner,
      pot: totalPotAmount,
    }, awards);
  }

  function deriveShowdownIfPossible(round, state) {
    if (state.ended) return;
    const eligiblePlayers = state.players.filter(player => !state.folded.has(player));
    if (eligiblePlayers.length < 2) return;

    const requiredOffsets = [
      0, 1, 2, 3, 4,
      ...eligiblePlayers.flatMap(player => {
        const playerOffset = state.players.indexOf(player);
        return [playerOffset * 2 + 5, playerOffset * 2 + 6];
      }),
    ];

    if (!allPublicCardsAvailable(round.round, requiredOffsets)) {
      return;
    }

    const cardsByOffset = new Map();
    try {
      for (const offset of requiredOffsets) {
        cardsByOffset.set(offset, decryptPublicCard(round.round, offset));
      }
    } catch (error) {
      addError(errors, null, `Round ${round.round} cannot decrypt public showdown cards: ${error.message}`);
      return;
    }

    const seenCards = new Map();
    for (const cardInfo of cardsByOffset.values()) {
      const id = cardInfo.phe;
      if (seenCards.has(id)) {
        addError(errors, null, `Round ${round.round} reveals duplicate plaintext card ${id}`);
      }
      seenCards.set(id, cardInfo.offset);
    }

    const board = [0, 1, 2, 3, 4].map(offset => cardsByOffset.get(offset));
    const strengthOfPlayers = eligiblePlayers.map(player => {
      const playerOffset = state.players.indexOf(player);
      const holeOffsets = [playerOffset * 2 + 5, playerOffset * 2 + 6];
      const hole = holeOffsets.map(offset => cardsByOffset.get(offset));
      const strength = evaluateCards([...hole, ...board].map(cardInfo => cardInfo.phe));
      return {
        player,
        hole: hole.map(cardInfo => cardInfo.phe),
        strength,
        handValue: handRank(strength),
        handName: rankDescription[handRank(strength)],
      };
    });

    const showdown = [];
    for (const playerStrength of strengthOfPlayers.sort((a, b) => a.strength - b.strength)) {
      const last = showdown.length > 0 ? showdown[showdown.length - 1] : null;
      if (last && last.strength === playerStrength.strength) {
        last.players.push(playerStrength.player);
      } else {
        showdown.push({
          players: [playerStrength.player],
          handValue: playerStrength.handValue,
          handName: playerStrength.handName,
          strength: playerStrength.strength,
        });
      }
    }

    const awards = calculateAwards(state.pot, showdown);
    applyAwards(round, state, {
      how: 'Showdown',
      board: board.map(cardInfo => cardInfo.phe),
      players: strengthOfPlayers
        .sort((a, b) => a.player.localeCompare(b.player))
        .map(({ player, hole, strength, handValue, handName }) => ({
          player,
          hole,
          strength,
          handValue,
          handName,
        })),
      showdown,
    }, awards);
  }

  function validateTexasHoldem(entry) {
    const payload = payloadOf(entry.wireEvent);
    if (!payload || typeof payload.type !== 'string') return;

    // Lifecycle/settings events may omit a numeric round. Validate their shape
    // and acknowledge them so the verifier recognizes EVERY table event type
    // instead of silently skipping the ones without a round. (Audit D02.)
    if (payload.type === 'action/updateSettings') {
      if (!payload.settings || typeof payload.settings !== 'object') {
        addError(errors, entry.index, 'updateSettings event is missing settings');
      } else if (payload.settings.initialFundAmount !== undefined
        && typeof payload.settings.initialFundAmount !== 'number') {
        addError(errors, entry.index, 'updateSettings initialFundAmount must be a number when present');
      }
      if (establishedHost !== null && senderOf(entry) !== establishedHost) {
        addWarning(warnings, entry.index, `updateSettings by non-host ${senderOf(entry)}; only the table host (${establishedHost}) may change settings`);
      }
      return;
    }
    if (payload.type === 'action/sitOut'
      || payload.type === 'action/returnToTable'
      || payload.type === 'action/openRegistration') {
      if (payload.round != null && typeof payload.round !== 'number') {
        addError(errors, entry.index, `${payload.type} round must be a number when present`);
      }
      if (payload.type === 'action/openRegistration'
        && establishedHost !== null && senderOf(entry) !== establishedHost) {
        addWarning(warnings, entry.index, `openRegistration by non-host ${senderOf(entry)}; only the table host (${establishedHost}) may reopen registration`);
      }
      return;
    }

    if (typeof payload.round !== 'number') return;

    const round = ensureRound(rounds, payload.round);
    const sender = senderOf(entry);

    switch (payload.type) {
      case 'newRound': {
        if (round.texasHoldem.newRound) {
          addError(errors, entry.index, `Duplicate newRound for round ${payload.round}`);
        }
        // The signer of the first newRound is the table host (R2.07 host-authority).
        if (establishedHost === null) {
          establishedHost = sender;
        }
        round.texasHoldem.newRound = true;
        round.texasHoldem.players = payload.players ?? [];
        if (!round.mentalPoker.finalized) {
          addError(errors, entry.index, `Round ${payload.round} newRound happened before deck finalization`);
        }
        if (!Array.isArray(payload.players) || payload.players.length < 2) {
          addError(errors, entry.index, `Round ${payload.round} must have at least 2 players`);
          return;
        }
        if (new Set(payload.players).size !== payload.players.length) {
          addError(errors, entry.index, `Round ${payload.round} has duplicate players`);
        }
        if (!payload.settings || typeof payload.settings.initialFundAmount !== 'number' || payload.settings.initialFundAmount < 2) {
          addError(errors, entry.index, `Round ${payload.round} initial fund must be at least 2`);
        }
        texasStateByRound.set(payload.round, initialTexasState(payload));
        round.texasHoldem.potTotal = 3;
        break;
      }
      case 'action/bet': {
        const state = texasStateByRound.get(payload.round);
        if (!state) {
          addError(errors, entry.index, `Bet for unknown round ${payload.round}`);
          return;
        }
        if (!state.players.includes(sender)) {
          addError(errors, entry.index, `Bet sender ${sender} is not in round ${payload.round}`);
          return;
        }
        if (state.ended) {
          addError(errors, entry.index, `Bet after round ${payload.round} already ended`);
        }
        if (state.folded.has(sender)) {
          addError(errors, entry.index, `Folded player ${sender} attempted to bet`);
        }
        // T2.3/C14: amounts are integer chip units.
        if (!Number.isSafeInteger(payload.amount) || payload.amount < 0) {
          addError(errors, entry.index, `Invalid bet amount in round ${payload.round}`);
          return;
        }
        const fund = state.funds.get(sender) ?? 0;
        if (payload.amount > fund) {
          addError(errors, entry.index, `Bet exceeds available fund for ${sender}`);
          return;
        }
        // T2.3/D03: a bet must bring the sender's total contribution up to at least
        // the current highest contribution (call/raise) unless it is an all-in.
        const currentMax = Array.from(state.pot.values()).reduce((max, value) => Math.max(max, value), 0);
        const senderNewTotal = (state.pot.get(sender) ?? 0) + payload.amount;
        const isAllIn = payload.amount === fund;
        if (senderNewTotal < currentMax && !isAllIn) {
          addError(errors, entry.index, `Round ${payload.round} bet by ${sender} totals ${senderNewTotal}, below the call amount ${currentMax} and not all-in`);
          return;
        }
        state.funds.set(sender, fund - payload.amount);
        globalFunds.set(sender, fund - payload.amount);
        state.pot.set(sender, (state.pot.get(sender) ?? 0) + payload.amount);
        round.texasHoldem.bets += 1;
        round.texasHoldem.potTotal = Array.from(state.pot.values()).reduce((a, b) => a + b, 0);
        break;
      }
      case 'action/fold': {
        const state = texasStateByRound.get(payload.round);
        if (!state) {
          addError(errors, entry.index, `Fold for unknown round ${payload.round}`);
          return;
        }
        if (!state.players.includes(sender)) {
          addError(errors, entry.index, `Fold sender ${sender} is not in round ${payload.round}`);
          return;
        }
        if (state.ended) {
          addError(errors, entry.index, `Fold after round ${payload.round} already ended`);
        }
        state.folded.add(sender);
        round.texasHoldem.folds += 1;
        const playersLeft = state.players.filter(player => !state.folded.has(player));
        if (playersLeft.length === 1) {
          round.texasHoldem.endedByFold = true;
          deriveLastOneWins(round, state, playersLeft[0]);
        }
        break;
      }
      case 'action/autoFold': {
        // An auto-fold removes the *target* player (not the sender) from the
        // hand, exactly like a manual fold. Replaying it lets the verifier
        // derive the correct settlement instead of ignoring it. (Audit D02.)
        const state = texasStateByRound.get(payload.round);
        if (!state) {
          addError(errors, entry.index, `AutoFold for unknown round ${payload.round}`);
          return;
        }
        const target = payload.target;
        if (typeof target !== 'string' || target.length === 0) {
          addError(errors, entry.index, `Round ${payload.round} autoFold is missing a target player`);
          return;
        }
        if (!state.players.includes(target)) {
          addError(errors, entry.index, `AutoFold target ${target} is not in round ${payload.round}`);
          return;
        }
        if (state.ended) {
          addError(errors, entry.index, `AutoFold after round ${payload.round} already ended`);
        }
        if (!state.folded.has(target)) {
          state.folded.add(target);
          round.texasHoldem.autoFolds += 1;
          round.texasHoldem.folds += 1;
          const playersLeft = state.players.filter(player => !state.folded.has(player));
          if (playersLeft.length === 1) {
            round.texasHoldem.endedByFold = true;
            deriveLastOneWins(round, state, playersLeft[0]);
          }
        }
        break;
      }
      case 'action/voidHandVote': {
        // Structural validation + vote accounting. Full void/pause consensus
        // derivation is intentionally out of scope for the local verifier, but
        // the event is no longer silently skipped. (Audit D02.)
        if (typeof payload.approve !== 'boolean') {
          addError(errors, entry.index, `Round ${payload.round} voidHandVote.approve must be a boolean`);
        }
        const state = texasStateByRound.get(payload.round);
        if (state && !state.players.includes(sender)) {
          addError(errors, entry.index, `voidHandVote sender ${sender} is not in round ${payload.round}`);
        }
        round.texasHoldem.voidVotes += 1;
        break;
      }
    }
  }

  for (const entry of transcript.entries) {
    if (!entry.signed) {
      addError(errors, entry.index, 'Unsigned event is not allowed in Fair Poker v0 transcripts');
    }
    const payload = payloadOf(entry.wireEvent);
    if (!payload || typeof payload.type !== 'string') {
      addError(errors, entry.index, 'Transcript entry payload is missing type');
      continue;
    }

    // T1.4: collect this round's PUBLIC signed-event signatures for the canonical
    // hand hash (receiver-independent, so two transcripts can be compared). B09/D05.
    if (entry.scope === 'public' && isSignedGameEvent(entry.wireEvent) && typeof payload.round === 'number') {
      if (!publicSignaturesByRound.has(payload.round)) {
        publicSignaturesByRound.set(payload.round, []);
      }
      publicSignaturesByRound.get(payload.round).push(entry.wireEvent.signature);
    }

    // Per-(sender, session) signed-sequence replay / ordering check. Reused
    // sequence numbers within one signing session are flagged as a possible
    // replay; out-of-order ones are warned. A page reload starts a new session
    // (new nonce), so its reset counter is not mistaken for a replay.
    // (Audit B06 per-sender sequence; B05/B07 domain separation.)
    if (isSignedGameEvent(entry.wireEvent) && typeof entry.wireEvent.sequence === 'number') {
      const sequenceSender = senderOf(entry);
      const nonce = typeof entry.wireEvent.sessionNonce === 'string' ? entry.wireEvent.sessionNonce : '';
      const scopeKey = `${sequenceSender}::${nonce}`;
      const sequence = entry.wireEvent.sequence;
      let track = signedSequenceByScope.get(scopeKey);
      if (!track) {
        track = { last: null, seen: new Set() };
        signedSequenceByScope.set(scopeKey, track);
      }
      if (track.seen.has(sequence)) {
        addError(errors, entry.index, `Duplicate signed sequence ${sequence} from ${sequenceSender} within one session (possible replay)`);
      } else {
        if (track.last !== null && sequence <= track.last) {
          addWarning(warnings, entry.index, `Out-of-order signed sequence ${sequence} from ${sequenceSender} (previous ${track.last})`);
        }
        track.seen.add(sequence);
        track.last = sequence;
      }
    }

    validateMentalPoker(entry);
    validateTexasHoldem(entry);
  }

  for (const round of Array.from(rounds.values())) {
    const state = texasStateByRound.get(round.round);
    if (state) {
      deriveShowdownIfPossible(round, state);
      if (!state.ended) {
        const revealedShowdownOffsets = publicDecryptKeysByRound.get(round.round);
        const hasAnyPublicReveal = !!revealedShowdownOffsets && revealedShowdownOffsets.size > 0;
        if (hasAnyPublicReveal) {
          addWarning(warnings, null, `Round ${round.round} does not yet have enough public reveal data to derive a final result`);
        }
        round.texasHoldem.finalFunds = mapToSortedEntries(state.funds);
      }
    }
    if (round.mentalPoker.start && !round.mentalPoker.finalized) {
      addWarning(warnings, null, `Round ${round.round} mental-poker deck is not finalized in this local transcript`);
    }
    if (round.texasHoldem.newRound && !round.mentalPoker.finalized) {
      addError(errors, null, `Round ${round.round} has table play without finalized deck`);
    }
    // T1.4: canonical, receiver-independent hand hash. Serialized identically to
    // src/lib/fairness/handConsensus.ts so a player's live receipt and this
    // offline value can be compared across transcripts. (B09/D05.)
    const signatures = (publicSignaturesByRound.get(round.round) || []).slice().sort();
    round.canonicalHandHash = `sha256:${sha256Hex(JSON.stringify({round: round.round, signatures}))}`;
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    rounds: Array.from(rounds.values()).sort((a, b) => a.round - b.round),
  };
}

async function derivePeerIdFromSigningPublicKey(publicKeyJwk) {
  const hash = crypto.createHash('sha256').update(canonicalJson(publicKeyJwk)).digest();
  return bytesToBase64Url(hash).slice(0, 16).toLowerCase();
}

async function fingerprintPublicKey(publicKeyJwk) {
  return `sha256:${sha256Hex(canonicalJson(publicKeyJwk))}`;
}

async function verifySignedGameEvent(event, transportSender) {
  if (event.sender !== transportSender) {
    return {
      ok: false,
      reason: `Envelope sender ${event.sender} does not match transport sender ${transportSender}`,
    };
  }

  const derivedPeerId = await derivePeerIdFromSigningPublicKey(event.publicKeyJwk);
  if (derivedPeerId !== event.sender) {
    return {
      ok: false,
      reason: `Signing key derives peer id ${derivedPeerId}, not ${event.sender}`,
    };
  }

  const actualFingerprint = await fingerprintPublicKey(event.publicKeyJwk);
  if (actualFingerprint !== event.publicKeyFingerprint) {
    return {
      ok: false,
      reason: 'Public key fingerprint mismatch',
    };
  }

  const actualPayloadHash = `sha256:${sha256Hex(canonicalJson(event.payload))}`;
  if (actualPayloadHash !== event.payloadHash) {
    return {
      ok: false,
      reason: 'Payload hash mismatch',
    };
  }

  const { signature, ...unsigned } = event;
  const publicKey = await crypto.webcrypto.subtle.importKey(
    'jwk',
    event.publicKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );

  const signatureValid = await crypto.webcrypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    base64UrlToBytes(signature),
    new TextEncoder().encode(canonicalJson(unsigned)),
  );

  return signatureValid
    ? { ok: true }
    : { ok: false, reason: 'Signature verification failed' };
}

async function verifyTranscript(transcript) {
  if (!transcript || transcript.version !== 'fairpoker.transcript.v1') {
    return { ok: false, reason: 'Unsupported transcript version' };
  }

  let previousHash = GENESIS_TRANSCRIPT_HASH;
  const eventTypes = {};
  let signedEvents = 0;
  let unsignedEvents = 0;

  for (let i = 0; i < transcript.entries.length; i++) {
    const entry = transcript.entries[i];

    if (entry.index !== i) {
      return { ok: false, failedIndex: i, reason: `Expected index ${i}, got ${entry.index}` };
    }
    if (entry.previousHash !== previousHash) {
      return { ok: false, failedIndex: i, reason: 'Previous hash mismatch' };
    }

    const signed = isSignedGameEvent(entry.wireEvent);
    const payload = signed ? entry.wireEvent.payload : entry.wireEvent;
    if (payload && typeof payload === 'object' && typeof payload.type === 'string') {
      eventTypes[payload.type] = (eventTypes[payload.type] || 0) + 1;
    }

    if (signed) {
      signedEvents += 1;
      const verification = await verifySignedGameEvent(entry.wireEvent, entry.transportSender);
      if (!verification.ok) {
        return { ok: false, failedIndex: i, reason: verification.reason };
      }
    } else {
      unsignedEvents += 1;
    }

    const { eventHash, ...entryWithoutHash } = entry;
    const recomputedHash = `sha256:${sha256Hex(canonicalJson({
      ...entryWithoutHash,
      previousHash,
    }))}`;
    if (eventHash !== recomputedHash) {
      return { ok: false, failedIndex: i, reason: 'Event hash mismatch' };
    }

    previousHash = eventHash;
  }

  if (transcript.finalHash !== previousHash) {
    return { ok: false, reason: 'Final hash mismatch' };
  }

  return {
    ok: true,
    entries: transcript.entries.length,
    signedEvents,
    unsignedEvents,
    eventTypes,
    finalHash: previousHash,
  };
}

async function main() {
  const transcriptPath = process.argv[2];
  if (!transcriptPath) {
    console.error('Usage: npm run verify:transcript -- path/to/transcript.json');
    process.exit(2);
  }

  const transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
  const result = await verifyTranscript(transcript);
  const gameProtocol = result.ok
    ? analyzeGameProtocol(transcript)
    : { ok: false, errors: [], warnings: [], rounds: [] };
  const output = {
    ...result,
    gameProtocol,
    ok: result.ok && gameProtocol.ok,
  };
  console.log(JSON.stringify(output, null, 2));
  process.exit(output.ok ? 0 : 1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
