import {GameEvent, GameRoomEvents, GameRoomStatus} from "./GameRoom";
import {
  createPlayer,
  decodeStandardCard,
  DEFAULT_MENTAL_POKER_BITS,
  DecryptionKey,
  EncodedDeck,
  encodeStandardCard,
  getStandard52Deck,
  isEncodedStandardCard,
  Player,
  PublicKey,
  StandardCard
} from "./secureMentalPoker";
import {CARDS} from "./rules";
import Deferred from "./Deferred";
import {EventListener} from "./types";
import EventEmitter from "eventemitter3";
import LifecycleManager from "./LifecycleManager";
import {encryptAndSecureShuffle} from "./cryptoShuffle";
import {validateMentalPokerEvent, isMentalPokerEventType} from "./fairness/mentalPokerSchema";
import {sealCardKey, openCardKey} from "./fairness/privateEventCrypto";

export interface MentalPokerRoundSettings {
  participants?: string[];
  alice?: string;
  bob?: string;
  bits?: number;
}

export interface RoundStartEvent {
  type: 'start';
  round: number;
  mentalPokerSettings: MentalPokerRoundSettings;
}

export type StringEncodedDeck = string[];

export interface DeckShuffleEvent {
  type: 'deck/shuffle';
  round: number;
  player: string;
  shuffleIndex: number;
  deck: StringEncodedDeck;
  publicKey?: {
    p: string;
    q: string;
  };
}

export interface DeckLockEvent {
  type: 'deck/lock';
  round: number;
  player: string;
  lockIndex: number;
  deck: StringEncodedDeck;
}

export interface DeckFinalizedEvent {
  type: 'deck/finalized';
  round: number;
  player: string;
  deck: StringEncodedDeck;
}

export interface DecryptCardEvent {
  type: 'card/decrypt';
  round: number;
  cardOffset: number;
  player?: string;
  aliceOrBob?: 'alice' | 'bob';
  // Plaintext per-card key — used for PUBLIC reveals (board/showdown), which must
  // stay verifiable by the offline transcript verifier.
  decryptionKey?: { d: string; n: string };
  // End-to-end sealed per-card key — used for PRIVATE deals, so the relay only
  // sees ciphertext. Exactly one of decryptionKey / sealedKey is present.
  sealedKey?: string;
}

// Announces this client's RSA-OAEP public key so peers can seal private per-card
// decryption keys to it end-to-end. Sent as a signed public event, so the
// mapping peerId -> encryption key is authenticated by the signing identity.
export interface EncryptionKeyAnnounceEvent {
  type: 'identity/encryptionKey';
  publicKeyJwk: JsonWebKey;
}

// Local RSA-OAEP keypair used to seal (send) and open (receive) private per-card
// keys end-to-end, so the relay only sees ciphertext. Optional: when absent the
// room keeps the legacy plaintext private-key behavior (used by unit tests).
export interface MentalPokerCryptoOptions {
  privateKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
}

export type MentalPokerEvent =
  | RoundStartEvent
  | DeckShuffleEvent
  | DeckLockEvent
  | DeckFinalizedEvent
  | DecryptCardEvent
  | EncryptionKeyAnnounceEvent
;

function toStringEncodedDeck(deck: EncodedDeck): StringEncodedDeck {
  return deck.cards.map(i => i.toString());
}

function toBigIntEncodedDeck(deck: StringEncodedDeck): EncodedDeck {
  return new EncodedDeck(deck.map(s => BigInt(s)));
}

const SESSION_INDIVIDUAL_KEYS = 'fair-poker:individualKeys';
const SESSION_REVEALED_BOARD_CARDS = 'fair-poker:revealedBoardCards';

function clearLegacyPersistentItem(key: string) {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(key);
  }
}

// Per-card decryption secrets (and the revealed-board cache) are persisted for
// the lifetime of the hand that is currently being played, then erased the
// instant it resolves (wipePersistedRound, fired on every 'winner') and when the
// next hand begins. Persisting them to localStorage — rather than the old
// tab-only sessionStorage — is what lets an accidental browser close, a crash, or
// a mobile tab eviction recover the in-progress hand instead of stranding the
// whole table. sessionStorage is mirrored so a tab that blocks persistent storage
// (some private-browsing modes) still recovers a same-tab refresh.
//
// Honesty: card secrets never outlive on disk the single hand they belong to,
// which is exactly what the verify FAQ states.
function liveHandStores(): Storage[] {
  const stores: Storage[] = [];
  if (typeof localStorage !== 'undefined') {
    stores.push(localStorage);
  }
  if (typeof sessionStorage !== 'undefined') {
    stores.push(sessionStorage);
  }
  return stores;
}

function readLiveHandItem(key: string): string | null {
  for (const store of liveHandStores()) {
    const value = store.getItem(key);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function writeLiveHandItem(key: string, value: string) {
  for (const store of liveHandStores()) {
    try {
      store.setItem(key, value);
    } catch {
      // Storage full/denied: live-hand recovery is best-effort, never fatal.
    }
  }
}

// Erase every per-card decryption secret for one hand the moment it is over, so
// decryption material never lingers on disk past the hand it belongs to. Matching
// is by storage-key prefix so all participants' entries are cleared regardless of
// how many sat in the hand. The revealed-board cache (public after showdown) is
// only cleared when `includeBoard` is set (at the next hand), so a refresh during
// the settlement screen still shows the final board.
function wipePersistedRound(scope: string, round: number, includeBoard: boolean) {
  const normalizedScope = normalizeStorageScope(scope);
  const individualKeysPrefix = `${SESSION_INDIVIDUAL_KEYS}:${normalizedScope}:${round}:`;
  const revealedBoardKey = `${SESSION_REVEALED_BOARD_CARDS}:${normalizedScope}:${round}`;
  for (const store of liveHandStores()) {
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const storedKey = store.key(i);
      if (!storedKey) {
        continue;
      }
      if (storedKey.startsWith(individualKeysPrefix) || (includeBoard && storedKey === revealedBoardKey)) {
        doomed.push(storedKey);
      }
    }
    doomed.forEach(storedKey => store.removeItem(storedKey));
  }
}

function normalizeStorageScope(scope: string | undefined) {
  return encodeURIComponent(scope || 'local-table');
}

// A peer's RSA-OAEP PUBLIC key (announced once, when it joins) is what everyone
// else seals private per-card keys to. It used to live only in an in-memory map,
// so a refresh / browser-close wiped it — and because the announce predates the
// current hand, the relay never re-sends it on reconnect. The rebuilt client then
// could never seal the partner's hole cards and EVERY later hand's deal stalled
// forever. Persisting these PUBLIC keys to durable localStorage (they carry no
// secret; an attacker who can write localStorage already owns the tab) lets a
// refreshed / reopened client immediately seal again, so play continues without a
// re-handshake. Keyed per (table scope, peer) and never wiped with the hand.
const PERSISTED_PEER_ENCRYPTION_KEY = 'fair-poker:peerEncryptionKey';

function peerEncryptionKeyStorageKey(scope: string, peerId: string) {
  return `${PERSISTED_PEER_ENCRYPTION_KEY}:${normalizeStorageScope(scope)}:${encodeURIComponent(peerId)}`;
}

function persistPeerEncryptionKey(scope: string, peerId: string, jwk: JsonWebKey) {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(peerEncryptionKeyStorageKey(scope, peerId), JSON.stringify(jwk));
  } catch {
    // Storage full/denied: re-handshake on the next announce is the fallback.
  }
}

function loadPersistedPeerEncryptionKeys(scope: string): Map<string, JsonWebKey> {
  const out = new Map<string, JsonWebKey>();
  if (typeof localStorage === 'undefined') {
    return out;
  }
  const prefix = `${PERSISTED_PEER_ENCRYPTION_KEY}:${normalizeStorageScope(scope)}:`;
  for (let i = 0; i < localStorage.length; i += 1) {
    const storedKey = localStorage.key(i);
    if (!storedKey || !storedKey.startsWith(prefix)) {
      continue;
    }
    const raw = localStorage.getItem(storedKey);
    if (!raw) {
      continue;
    }
    try {
      out.set(decodeURIComponent(storedKey.slice(prefix.length)), JSON.parse(raw) as JsonWebKey);
    } catch {
      // Corrupt entry: ignore; a fresh announce will overwrite it.
    }
  }
  return out;
}

function getParticipants(settings: MentalPokerRoundSettings): string[] {
  const participants: string[] = [];
  const add = (participant?: string) => {
    if (participant && !participants.includes(participant)) {
      participants.push(participant);
    }
  };

  if (settings.participants?.length) {
    settings.participants.forEach(add);
    return participants;
  }
  add(settings.alice);
  add(settings.bob);
  return participants;
}

function individualKeysStorageKey(scope: string, round: number, participant: string) {
  return `${SESSION_INDIVIDUAL_KEYS}:${normalizeStorageScope(scope)}:${round}:${participant}`;
}

function legacyIndividualKeysStorageKey(round: number, participant: string) {
  return `${SESSION_INDIVIDUAL_KEYS}:${round}:${participant}`;
}

function storeIndividualKeys(scope: string, round: number, participant: string, player: Player, cards: number) {
  const keys: Record<number, { d: string; n: string }> = {};
  for (let i = 0; i < cards; i++) {
    const dk = player.getIndividualKey(i).decryptionKey;
    keys[i] = { d: dk.d.toString(), n: dk.n.toString() };
  }
  const legacyKey = legacyIndividualKeysStorageKey(round, participant);
  clearLegacyPersistentItem(legacyKey);
  sessionStorage.removeItem(legacyKey);
  writeLiveHandItem(individualKeysStorageKey(scope, round, participant), JSON.stringify(keys));
}

function loadIndividualKeys(scope: string, round: number, participant: string): Map<number, DecryptionKey> {
  const result = new Map<number, DecryptionKey>();
  const legacyKey = legacyIndividualKeysStorageKey(round, participant);
  clearLegacyPersistentItem(legacyKey);
  sessionStorage.removeItem(legacyKey);
  const storageKey = individualKeysStorageKey(scope, round, participant);
  const stored = readLiveHandItem(storageKey);
  if (stored) {
    const keys: Record<string, { d: string; n: string }> = JSON.parse(stored);
    for (const [offset, key] of Object.entries(keys)) {
      result.set(Number(offset), new DecryptionKey(BigInt(key.d), BigInt(key.n)));
    }
  }
  return result;
}

function revealedBoardCardStorageKey(scope: string, round: number) {
  return `${SESSION_REVEALED_BOARD_CARDS}:${normalizeStorageScope(scope)}:${round}`;
}

function legacyRevealedBoardCardStorageKey(round: number) {
  return `${SESSION_REVEALED_BOARD_CARDS}:${round}`;
}

function storeRevealedBoardCard(scope: string, round: number, offset: number, card: StandardCard) {
  if (offset < 0 || offset > 4) {
    return;
  }
  const legacyKey = legacyRevealedBoardCardStorageKey(round);
  clearLegacyPersistentItem(legacyKey);
  sessionStorage.removeItem(legacyKey);
  const storageKey = revealedBoardCardStorageKey(scope, round);
  const stored = readLiveHandItem(storageKey);
  const cards: Record<string, StandardCard> = stored ? JSON.parse(stored) : {};
  cards[String(offset)] = card;
  writeLiveHandItem(storageKey, JSON.stringify(cards));
}

function loadRevealedBoardCards(scope: string, round: number): Map<number, StandardCard> {
  const result = new Map<number, StandardCard>();
  const legacyKey = legacyRevealedBoardCardStorageKey(round);
  clearLegacyPersistentItem(legacyKey);
  sessionStorage.removeItem(legacyKey);
  const stored = readLiveHandItem(revealedBoardCardStorageKey(scope, round));
  if (!stored) {
    return result;
  }
  const cards: Record<string, StandardCard> = JSON.parse(stored);
  for (const [offset, card] of Object.entries(cards)) {
    if (card && offset && Number(offset) >= 0 && Number(offset) <= 4) {
      result.set(Number(offset), card);
    }
  }
  return result;
}

class MentalPokerRound {
  mentalPokerSettings: Deferred<MentalPokerRoundSettings> = new Deferred();
  participants: string[] = [];
  players: Map<string, Deferred<Player | null>> = new Map();
  sharedPublicKey: Deferred<PublicKey> = new Deferred();
  deck: Deferred<EncodedDeck> = new Deferred();
  decryptionKeys: Array<Map<string, Deferred<DecryptionKey>>> = new Array(CARDS).fill({}).map(() => new Map());
  individualKeys: Map<string, Map<number, DecryptionKey>> = new Map();

  setParticipants(participants: string[]) {
    this.participants = participants;
    for (const participant of participants) {
      if (!this.players.has(participant)) {
        this.players.set(participant, new Deferred<Player | null>());
      }
      if (!this.individualKeys.has(participant)) {
        this.individualKeys.set(participant, new Map());
      }
      for (const cardKeys of this.decryptionKeys) {
        if (!cardKeys.has(participant)) {
          cardKeys.set(participant, new Deferred<DecryptionKey>());
        }
      }
    }
  }

  playerDeferred(participant: string): Deferred<Player | null> {
    let existing = this.players.get(participant);
    if (!existing) {
      existing = new Deferred<Player | null>();
      this.players.set(participant, existing);
    }
    return existing;
  }

  cardKeyDeferred(cardOffset: number, participant: string): Deferred<DecryptionKey> {
    let existing = this.decryptionKeys[cardOffset].get(participant);
    if (!existing) {
      existing = new Deferred<DecryptionKey>();
      this.decryptionKeys[cardOffset].set(participant, existing);
    }
    return existing;
  }
}

export interface MentalPokerGameRoomEvents {
  connected: (peerId: string) => void;
  status: (status: GameRoomStatus) => void;
  members: (members: string[]) => void;

  shuffled: () => void;
  card: (round: number, offset: number, card: StandardCard) => void;
}

export interface GameRoomLike<T> {
  listener: EventListener<GameRoomEvents<GameEvent<T>>>;
  peerIdAsync: Promise<string>;
  peerId?: string;
  status?: GameRoomStatus;
  emitEvent: (e: GameEvent<T>) => Promise<void>;
  members: string[];
  close: () => void;
}

export default class MentalPokerGameRoom {
  private readonly emitter = new EventEmitter<MentalPokerGameRoomEvents>();
  private readonly gameRoom: GameRoomLike<MentalPokerEvent>;
  private readonly storageScope: string;
  private round: number = 0;

  private dataByRounds: Map<number, MentalPokerRound> = new Map();

  private readonly lcm = new LifecycleManager();

  // Local RSA-OAEP keypair (optional) and the authenticated map of peer
  // encryption public keys collected from `identity/encryptionKey` announces.
  private readonly cryptoOptions?: MentalPokerCryptoOptions;
  private readonly peerEncryptionKeys: Map<string, Deferred<CryptoKey>> = new Map();
  // Peers whose encryption key we have already locked in (first-announce-wins, to
  // match the live resolve-once semantics and avoid redundant re-persists).
  private readonly knownPeerEncryptionKeys: Set<string> = new Set();

  constructor(
    gameRoom: GameRoomLike<MentalPokerEvent | any>,
    storageScope?: string,
    cryptoOptions?: MentalPokerCryptoOptions,
  ) {
    this.gameRoom = gameRoom;
    this.storageScope = storageScope || 'local-table';
    this.cryptoOptions = cryptoOptions;

    this.propagate('status');
    this.propagate('connected');
    this.propagate('members');

    // Recover partners' announced PUBLIC encryption keys from a prior session, so a
    // refresh / browser-close can immediately seal per-card keys to them again
    // (their one-time announce is never replayed on reconnect). See the persistence
    // helpers above for why this is safe (public-only) and necessary.
    this.restorePersistedPeerEncryptionKeys();

    this.gameRoom.listener.on('event', this.lcm.register(({ data }, who, replay) => {
      // Reject structurally invalid deck/key wire events before they reach
      // BigInt() and the SRA crypto, so malformed/oversized payloads cannot
      // throw, stall, or corrupt the deck. Only mental-poker events are gated
      // here; other event types pass through untouched. (Audit C03/C04/C05/E02.)
      if (isMentalPokerEventType((data as {type?: unknown}).type)) {
        const validation = validateMentalPokerEvent(data);
        if (!validation.ok) {
          console.warn(`Dropping invalid mental-poker event: ${validation.reason}`);
          return;
        }
      }
      switch (data.type) {
        case 'start':
          this.handleRoundStartEvent(data, !!replay);
          break;
        case 'deck/shuffle':
          this.handleDeckShuffleEvent(data, !!replay, who);
          break;
        case 'deck/lock':
          this.handleDeckLockEvent(data, !!replay, who);
          break;
        case 'deck/finalized':
          this.handleDeckFinalizedEvent(data, who);
          break;
        case 'card/decrypt':
          this.handleCardDecrypted(data, who);
          break;
        case 'identity/encryptionKey':
          void this.handleEncryptionKeyAnnounce(data, who);
          break;
      }
    }, listener => this.gameRoom.listener.off('event', listener)));
  }

  async startNewRound(settings: MentalPokerRoundSettings) {
    // The previous hand is over for good once a new one starts: drop its in-memory
    // state and erase its persisted decryption secrets + board cache so nothing
    // lingers on disk beyond the hand it belonged to.
    this.dataByRounds.delete(this.round);
    wipePersistedRound(this.storageScope, this.round, true);

    const newRound = ++this.round;
    this.getOrCreateDataForRound(newRound);

    await this.firePublicEvent({
      type: 'start',
      round: newRound,
      mentalPokerSettings: settings,
    });

    return newRound;
  }

  // Erase this hand's persisted per-card decryption secrets the moment it resolves
  // (win, fold-out, or void). Called by the Texas Hold'em engine on every 'winner'
  // so card secrets never outlive the hand on disk. The revealed-board cache is
  // kept until the next hand so a refresh on the settlement screen still shows the
  // final board.
  wipeRoundSecrets(round: number) {
    wipePersistedRound(this.storageScope, round, false);
  }

  // True when this client still holds (in memory, or persisted from before a
  // refresh/close) its own per-card decryption keys for `round` — i.e. it can
  // actually keep playing that hand. False means the keys are gone (e.g. a close +
  // reopen that cleared storage), so the hand is unrecoverable for this player and
  // must be voided rather than silently frozen.
  hasIndividualKeysForRound(round: number): boolean {
    const me = this.gameRoom.peerId;
    if (!me) {
      return false;
    }
    const live = this.dataByRounds.get(round)?.individualKeys.get(me);
    if (live && live.size > 0) {
      return true;
    }
    return loadIndividualKeys(this.storageScope, round, me).size > 0;
  }

  get members() {
    return this.gameRoom.members;
  }

  get peerId() {
    return this.gameRoom.peerId;
  }

  get status() {
    return this.gameRoom.status ?? 'NotReady';
  }

  private getOrCreateDataForRound(round: number): MentalPokerRound {
    if (this.round < round) {
      this.round = round;
    }
    const existing = this.dataByRounds.get(round);
    if (existing) {
      return existing;
    }

    const newRoundData = new MentalPokerRound();

    // bind events
    newRoundData.decryptionKeys.forEach((_decryptionKey, offset) => {
      newRoundData.mentalPokerSettings.promise.then(settings => {
        const participants = getParticipants(settings);
        newRoundData.setParticipants(participants);
        Promise.all([
          ...participants.map(participant => newRoundData.cardKeyDeferred(offset, participant).promise),
          newRoundData.deck.promise,
        ]).then(async (values) => {
          const deck = values[values.length - 1] as EncodedDeck;
          const keys = values.slice(0, -1) as DecryptionKey[];
          const fullyDecrypted = keys.reduce(
            (encryptedCard, key) => key.decrypt(encryptedCard),
            deck.cards[offset],
          );
          const encodedCard = Number(fullyDecrypted);
          if (!isEncodedStandardCard(encodedCard)) {
            console.warn(`Ignoring invalid decrypted card for round ${round}, offset ${offset}.`);
            return;
          }
          const card = decodeStandardCard(encodedCard);
          storeRevealedBoardCard(this.storageScope, round, offset, card);
          console.log(`The card [${offset}] has been decrypted: ${card.suit} ${card.rank}`);
          this.emitter.emit('card', round, offset, card);
        }).catch(err => {
          console.warn(`Unable to decrypt card for round ${round}, offset ${offset}.`, err);
        });
      });
    });
    newRoundData.deck.promise.then(() => {
      this.emitter.emit('shuffled');
    });

    this.dataByRounds.set(round, newRoundData);
    for (const [offset, card] of Array.from(loadRevealedBoardCards(this.storageScope, round).entries())) {
      this.emitter.emit('card', round, offset, card);
    }
    return newRoundData;
  }

  private async getDecryptionKeyForCard(
    roundData: MentalPokerRound,
    cardOffset: number,
    participant: string,
  ): Promise<{ d: string; n: string } | null> {
    const myPeerId = await this.gameRoom.peerIdAsync;
    if (participant === myPeerId) {
      const player = await roundData.playerDeferred(participant).promise;
      if (player) {
        const dk = player.getIndividualKey(cardOffset).decryptionKey;
        return { d: dk.d.toString(), n: dk.n.toString() };
      }
    }

    // Fall back to tab-session individual keys after page refresh/replay.
    // Do not persist per-card decryption material in localStorage.
    const storedKeys = roundData.individualKeys.get(participant);
    if (!storedKeys) {
      return null;
    }
    const dk = storedKeys.get(cardOffset);
    return dk ? { d: dk.d.toString(), n: dk.n.toString() } : null;
  }

  private async participantsForRound(roundData: MentalPokerRound): Promise<string[]> {
    if (roundData.participants.length > 0) {
      return roundData.participants;
    }
    const settings = await roundData.mentalPokerSettings.promise;
    const participants = getParticipants(settings);
    roundData.setParticipants(participants);
    return participants;
  }

  async showCard(round: number, cardOffset: number) {
    const roundData = this.dataByRounds.get(round);
    if (!roundData) {
      console.warn(`There is no round ${round}.`);
      return;
    }

    const participants = await this.participantsForRound(roundData);
    for (const participant of participants) {
      const dk = await this.getDecryptionKeyForCard(roundData, cardOffset, participant);
      if (dk) {
        console.debug(`[${participant}] showing the card [ ${cardOffset} ] to all the players.`);
        await this.firePublicEvent({
          type: 'card/decrypt',
          round,
          cardOffset,
          player: participant,
          decryptionKey: dk,
        });
      }
    }
  }

  async dealCard(round: number, cardOffset: number, recipient: string) {
    const roundData = this.dataByRounds.get(round);
    if (!roundData) {
      console.warn(`There is no round ${round}.`);
      return;
    }

    const myPeerId = await this.gameRoom.peerIdAsync;
    const participants = await this.participantsForRound(roundData);
    for (const participant of participants) {
      const dk = await this.getDecryptionKeyForCard(roundData, cardOffset, participant);
      if (dk) {
        // Resolve our own card locally with the plaintext key (never hits the wire).
        if (recipient === myPeerId) {
          await this.handleCardDecrypted(
            {type: 'card/decrypt', round, cardOffset, player: participant, decryptionKey: dk},
            participant,
          );
        }
        // Wire event: end-to-end sealed to the recipient when crypto is enabled
        // (relay sees only ciphertext); legacy plaintext otherwise. Fail closed
        // (skip + let the caller retry) rather than ever downgrade to plaintext.
        const wireEvent = await this.buildCardDecryptWireEvent(participant, dk, recipient, round, cardOffset);
        if (!wireEvent) {
          continue;
        }
        console.debug(`Dealing the card [ ${cardOffset} ] to ${recipient}.`);
        await this.firePrivateEvent(wireEvent, recipient);
      }
    }
  }

  private async buildCardDecryptWireEvent(
    participant: string,
    dk: { d: string; n: string },
    recipient: string,
    round: number,
    cardOffset: number,
  ): Promise<DecryptCardEvent | null> {
    const base = {type: 'card/decrypt' as const, round, cardOffset, player: participant};
    if (!this.cryptoOptions) {
      return {...base, decryptionKey: dk};
    }
    const recipientKey = await this.awaitPeerEncryptionKey(recipient);
    if (!recipientKey) {
      console.warn(`No encryption key available for ${recipient} yet; deferring sealed deal for round ${round} card ${cardOffset} (will retry).`);
      return null;
    }
    const sealedKey = await sealCardKey(dk, {sender: participant, recipient, round, cardOffset}, recipientKey);
    return {...base, sealedKey};
  }

  private async awaitPeerEncryptionKey(peerId: string, timeoutMs = 8000): Promise<CryptoKey | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
      (timer as unknown as {unref?: () => void}).unref?.();
    });
    try {
      return await Promise.race([this.getPeerEncryptionKey(peerId), timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  get listener(): EventListener<MentalPokerGameRoomEvents> {
    return this.emitter;
  }

  close() {
    this.gameRoom.close();
    this.lcm.close();
  }

  private propagate(eventName: (keyof (GameRoomEvents<MentalPokerEvent> | MentalPokerGameRoomEvents))) {
    this.gameRoom.listener.on(eventName, this.lcm.register((...args) => {
      this.emitter.emit(eventName, ...args);
    }, listener => this.gameRoom.listener.off(eventName, listener)));
  }

  private async handleRoundStartEvent(e: RoundStartEvent, replay: boolean) {
    const settings = e.mentalPokerSettings;
    const participants = getParticipants(settings);

    const roundData = this.getOrCreateDataForRound(e.round);
    roundData.setParticipants(participants);
    roundData.mentalPokerSettings.resolve(settings);

    if (replay) {
      // During replay, skip Player creation and outgoing events.
      // The deck and card/decrypt events are already in the log
      // and will be replayed, resolving decryption keys directly.
      // Load stored individual keys so showCard/dealCard can work post-replay.
      for (const participant of participants) {
        roundData.playerDeferred(participant).resolve(null);
        roundData.individualKeys.set(participant, loadIndividualKeys(this.storageScope, e.round, participant));
      }
      return;
    }

    const myPeerId = await this.gameRoom.peerIdAsync;
    if (participants[0] === myPeerId) {
      console.debug(`Creating mental poker player ${myPeerId}`);
      const playerPromise = createPlayer({
        cards: CARDS,
        bits: settings.bits ?? DEFAULT_MENTAL_POKER_BITS,
      });
      roundData.playerDeferred(myPeerId).resolve(playerPromise);

      const player = await playerPromise;
      storeIndividualKeys(this.storageScope, e.round, myPeerId, player, CARDS);

      console.debug(`Encrypting and shuffling the deck by ${myPeerId}.`);

      const standard52Deck = getStandard52Deck();
      const deckEncoded = new EncodedDeck(
        standard52Deck.map((card) => BigInt(encodeStandardCard(card)))
      );
      const deckEncrypted = encryptAndSecureShuffle(player, deckEncoded);
      await this.firePublicEvent({
        type: 'deck/shuffle',
        round: e.round,
        player: myPeerId,
        shuffleIndex: 0,
        deck: toStringEncodedDeck(deckEncrypted),
        publicKey: {
          p: player.publicKey.p.toString(),
          q: player.publicKey.q.toString(),
        }
      });
    }
  }

  private async createLocalPlayer(
    round: number,
    roundData: MentalPokerRound,
    settings: MentalPokerRoundSettings,
    participant: string,
    publicKey: PublicKey,
  ): Promise<Player> {
    console.debug(`Creating mental poker player ${participant}`);
    const playerPromise = createPlayer({
      cards: CARDS,
      publicKey,
      bits: settings.bits ?? DEFAULT_MENTAL_POKER_BITS,
    });
    roundData.playerDeferred(participant).resolve(playerPromise);

    const player = await playerPromise;
    storeIndividualKeys(this.storageScope, round, participant, player, CARDS);
    return player;
  }

  private senderMatchesEventPlayer(sender: string | undefined, e: {type: string; round: number; player: string}) {
    if (!sender || sender === e.player) {
      return true;
    }
    console.warn(`Ignoring ${e.type} event for round ${e.round}: sender ${sender} cannot act as ${e.player}.`);
    return false;
  }

  private async handleDeckShuffleEvent(e: DeckShuffleEvent, replay: boolean, sender?: string) {
    if (!this.senderMatchesEventPlayer(sender, e)) {
      return;
    }
    if (replay) return;
    const roundData = this.getOrCreateDataForRound(e.round);
    const settings = await roundData.mentalPokerSettings.promise;
    const participants = getParticipants(settings);
    roundData.setParticipants(participants);
    const myPeerId = await this.gameRoom.peerIdAsync;
    const expectedPlayer = participants[e.shuffleIndex];

    if (!expectedPlayer || e.player !== expectedPlayer) {
      console.warn(`Ignoring out-of-order shuffle event for round ${e.round}.`);
      return;
    }

    if (e.publicKey) {
      roundData.sharedPublicKey.resolve(new PublicKey(BigInt(e.publicKey.p), BigInt(e.publicKey.q)));
    }

    const nextShuffleIndex = e.shuffleIndex + 1;
    if (nextShuffleIndex < participants.length) {
      const nextParticipant = participants[nextShuffleIndex];
      if (nextParticipant === myPeerId) {
        const sharedPublicKey = await roundData.sharedPublicKey.promise;
        const player = await this.createLocalPlayer(e.round, roundData, settings, myPeerId, sharedPublicKey);

        console.debug(`Encrypting and shuffling the deck by ${myPeerId}.`);
        const encryptedDeck = encryptAndSecureShuffle(player, toBigIntEncodedDeck(e.deck));

        await this.firePublicEvent({
          type: 'deck/shuffle',
          round: e.round,
          player: myPeerId,
          shuffleIndex: nextShuffleIndex,
          deck: toStringEncodedDeck(encryptedDeck),
        });
      }
      return;
    }

    if (participants[0] === myPeerId) {
      const player = await roundData.playerDeferred(myPeerId).promise;
      if (!player) return;

      console.debug(`Removing main lock and adding per-card locks by ${myPeerId}.`);
      const lockedDeck = player.decryptAndEncryptIndividually(toBigIntEncodedDeck(e.deck));
      await this.firePublicEvent({
        type: 'deck/lock',
        round: e.round,
        player: myPeerId,
        lockIndex: 0,
        deck: toStringEncodedDeck(lockedDeck),
      });
    }
  }

  private async handleDeckLockEvent(e: DeckLockEvent, replay: boolean, sender?: string) {
    if (!this.senderMatchesEventPlayer(sender, e)) {
      return;
    }
    if (replay) return;
    const roundData = this.getOrCreateDataForRound(e.round);
    const settings = await roundData.mentalPokerSettings.promise;
    const participants = getParticipants(settings);
    roundData.setParticipants(participants);
    const myPeerId = await this.gameRoom.peerIdAsync;
    const expectedPlayer = participants[e.lockIndex];

    if (!expectedPlayer || e.player !== expectedPlayer) {
      console.warn(`Ignoring out-of-order lock event for round ${e.round}.`);
      return;
    }

    const nextLockIndex = e.lockIndex + 1;
    if (nextLockIndex < participants.length) {
      const nextParticipant = participants[nextLockIndex];
      if (nextParticipant === myPeerId) {
        const player = await roundData.playerDeferred(myPeerId).promise;
        if (!player) return;

        console.debug(`Removing main lock and adding per-card locks by ${myPeerId}.`);
        const lockedDeck = player.decryptAndEncryptIndividually(toBigIntEncodedDeck(e.deck));
        await this.firePublicEvent({
          type: 'deck/lock',
          round: e.round,
          player: myPeerId,
          lockIndex: nextLockIndex,
          deck: toStringEncodedDeck(lockedDeck),
        });
      }
      return;
    }

    if (expectedPlayer === myPeerId) {
      console.debug(`Deck shuffling is finalized by ${myPeerId}.`);
      await this.firePublicEvent({
        type: 'deck/finalized',
        round: e.round,
        player: myPeerId,
        deck: e.deck,
      });
    }
  }

  private async handleDeckFinalizedEvent(e: DeckFinalizedEvent, sender?: string) {
    if (!this.senderMatchesEventPlayer(sender, e)) {
      return;
    }
    const roundData = this.getOrCreateDataForRound(e.round);
    const settings = await roundData.mentalPokerSettings.promise;
    const participants = getParticipants(settings);
    const expectedPlayer = participants[participants.length - 1];
    if (!expectedPlayer || e.player !== expectedPlayer) {
      console.warn(`Ignoring out-of-order deck finalization event for round ${e.round}.`);
      return;
    }
    roundData.deck.resolve(toBigIntEncodedDeck(e.deck));
  }

  // Returns the plaintext per-card key for an incoming card/decrypt event:
  // opens the sealed key with our private key (verifying the binding) when the
  // event is sealed, or returns the plaintext key for public reveals.
  private async resolveCardKeyMaterial(e: DecryptCardEvent, sender?: string): Promise<{ d: string; n: string } | null> {
    if (e.sealedKey) {
      if (!this.cryptoOptions) {
        console.warn(`Received a sealed card key but no local decryption key is configured (round ${e.round}, card ${e.cardOffset}).`);
        return null;
      }
      const myPeerId = await this.gameRoom.peerIdAsync;
      try {
        return await openCardKey(
          e.sealedKey,
          {sender: sender ?? e.player ?? '', recipient: myPeerId, round: e.round, cardOffset: e.cardOffset},
          this.cryptoOptions.privateKey,
        );
      } catch (error) {
        console.warn(`Failed to open sealed card key (round ${e.round}, card ${e.cardOffset}).`, error);
        return null;
      }
    }
    return e.decryptionKey ?? null;
  }

  private async handleCardDecrypted(e: DecryptCardEvent, sender?: string) {
    const roundData = this.getOrCreateDataForRound(e.round);
    const keyMaterial = await this.resolveCardKeyMaterial(e, sender);
    if (!keyMaterial) {
      return;
    }
    const dk = new DecryptionKey(BigInt(keyMaterial.d), BigInt(keyMaterial.n));
    let participant = e.player;
    if (!participant && e.aliceOrBob) {
      const settings = await roundData.mentalPokerSettings.promise;
      participant = e.aliceOrBob === 'alice' ? settings.alice : settings.bob;
    }
    if (participant) {
      if (sender && sender !== participant) {
        console.warn(`Ignoring card/decrypt event for round ${e.round}, card ${e.cardOffset}: sender ${sender} cannot provide ${participant}'s key.`);
        return;
      }
      roundData.cardKeyDeferred(e.cardOffset, participant).resolve(dk);
    }
  }

  private async firePublicEvent(e: MentalPokerEvent) {
    await this.gameRoom.emitEvent({
      type: 'public',
      sender: await this.gameRoom.peerIdAsync,
      data: e,
    });
  }

  private async firePrivateEvent(e: MentalPokerEvent, recipient: string) {
    await this.gameRoom.emitEvent({
      type: 'private',
      sender: await this.gameRoom.peerIdAsync,
      recipient,
      data: e,
    });
  }

  private peerEncryptionKeyDeferred(peerId: string): Deferred<CryptoKey> {
    let deferred = this.peerEncryptionKeys.get(peerId);
    if (!deferred) {
      deferred = new Deferred<CryptoKey>();
      this.peerEncryptionKeys.set(peerId, deferred);
    }
    return deferred;
  }

  // Resolves a peer's announced RSA-OAEP public key, used to seal private card
  // keys to that peer. Stays pending until the peer announces its key.
  getPeerEncryptionKey(peerId: string): Promise<CryptoKey> {
    return this.peerEncryptionKeyDeferred(peerId).promise;
  }

  // Publishes this client's RSA-OAEP public key (signed public event) so peers
  // can seal private per-card keys to it. No-op without crypto options.
  async announceEncryptionKey(): Promise<void> {
    if (!this.cryptoOptions) {
      return;
    }
    await this.firePublicEvent({
      type: 'identity/encryptionKey',
      publicKeyJwk: this.cryptoOptions.publicKeyJwk,
    });
  }

  private async handleEncryptionKeyAnnounce(e: EncryptionKeyAnnounceEvent, sender?: string) {
    if (!sender) {
      return;
    }
    // First-announce-wins: ignore later re-announces for a peer whose key we already
    // hold (the live deferred is resolve-once anyway; this also avoids re-persisting).
    if (this.knownPeerEncryptionKeys.has(sender)) {
      return;
    }
    try {
      const key = await crypto.subtle.importKey(
        'jwk',
        e.publicKeyJwk,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        false,
        ['encrypt'],
      );
      this.knownPeerEncryptionKeys.add(sender);
      this.peerEncryptionKeyDeferred(sender).resolve(key);
      // Persist the PUBLIC key so a future refresh / reopen can seal to this peer
      // without waiting for an announce that the relay will not replay.
      persistPeerEncryptionKey(this.storageScope, sender, e.publicKeyJwk);
    } catch (error) {
      console.warn(`Ignoring invalid encryption key announce from ${sender}.`, error);
    }
  }

  // Re-import partners' PUBLIC encryption keys persisted in a previous session and
  // pre-resolve their deferreds, so seals can proceed the moment this client comes
  // back — no re-announce round-trip required. Best-effort: a bad/absent entry just
  // falls back to the next live announce.
  private restorePersistedPeerEncryptionKeys() {
    if (!this.cryptoOptions || typeof crypto === 'undefined' || !crypto.subtle) {
      return;
    }
    const persisted = loadPersistedPeerEncryptionKeys(this.storageScope);
    persisted.forEach((jwk, peerId) => {
      if (this.knownPeerEncryptionKeys.has(peerId)) {
        return;
      }
      void (async () => {
        try {
          const key = await crypto.subtle.importKey(
            'jwk',
            jwk,
            { name: 'RSA-OAEP', hash: 'SHA-256' },
            false,
            ['encrypt'],
          );
          if (this.knownPeerEncryptionKeys.has(peerId)) {
            return; // a live announce already locked it in
          }
          this.knownPeerEncryptionKeys.add(peerId);
          this.peerEncryptionKeyDeferred(peerId).resolve(key);
        } catch (error) {
          console.warn(`Ignoring invalid persisted encryption key for ${peerId}.`, error);
        }
      })();
    });
  }
}
