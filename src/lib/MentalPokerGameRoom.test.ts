import { GameRoomEvents, GameEvent } from "./GameRoom";
import MentalPokerGameRoom, {GameRoomLike, MentalPokerEvent} from "./MentalPokerGameRoom";
import EventEmitter from "eventemitter3";
import Deferred from "./Deferred";
import {createPlayer, MAX_MENTAL_POKER_BITS, MIN_MENTAL_POKER_BITS, normalizeMentalPokerBits, StandardCard} from "./secureMentalPoker";
import {sealCardKey, openCardKey} from "./fairness/privateEventCrypto";

async function generateRsaPair() {
  return window.crypto.subtle.generateKey(
    {name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'},
    true,
    ['encrypt', 'decrypt'],
  );
}

class MockGameRoom implements GameRoomLike<MentalPokerEvent> {
  listener = new EventEmitter<GameRoomEvents<GameEvent<MentalPokerEvent>>>();
  peerIdAsync: Promise<string>;
  peerIdDeferred = new Deferred<string>();
  peerId?: string;
  members: string[] = [];

  eventsEmitted: Array<GameEvent<MentalPokerEvent>> = [];

  private paired: Set<MockGameRoom> = new Set();

  constructor() {
    this.peerIdAsync = this.peerIdDeferred.promise;
    void this.peerIdAsync.then((id) => { this.peerId = id; });
  }

  async emitEvent(e: GameEvent<MentalPokerEvent>) {
    const myPeerId = await this.peerIdAsync;
    this.eventsEmitted.push(e);
    this.listener.emit('event', e, myPeerId);
    for (const paired of Array.from(this.paired)) {
      if (e.type === 'public' || e.recipient === await paired.peerIdAsync) {
        paired.listener.emit('event', e, myPeerId);
      }
    }
  }

  get lastEventEmitted() {
    return this.eventsEmitted[this.eventsEmitted.length - 1];
  }

  pair(another: MockGameRoom) {
    this.paired.add(another);
    another.paired.add(this);
  }

  close(): void {
  }
}

describe('MentalPokerGameRoom', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  test('clamps SRA bit sizes into the [floor, ceiling] security band', () => {
    // The floor was raised to 1024-bit primes (prime-field DLP below that is
    // attackable; Audit V2). Weak requests are upgraded (not thrown, which a
    // malicious tiny-bits event could weaponize), and huge requests are capped
    // instead of hanging every client generating gigantic primes (Audit V10).
    expect(MIN_MENTAL_POKER_BITS).toBeGreaterThanOrEqual(1024);
    expect(normalizeMentalPokerBits(8)).toBe(MIN_MENTAL_POKER_BITS);
    expect(normalizeMentalPokerBits(128)).toBe(MIN_MENTAL_POKER_BITS);
    expect(normalizeMentalPokerBits(512)).toBe(MIN_MENTAL_POKER_BITS);
    expect(normalizeMentalPokerBits(MIN_MENTAL_POKER_BITS - 1)).toBe(MIN_MENTAL_POKER_BITS);
    expect(normalizeMentalPokerBits(1_000_000)).toBe(MAX_MENTAL_POKER_BITS);
    expect(normalizeMentalPokerBits(MAX_MENTAL_POKER_BITS + 1)).toBe(MAX_MENTAL_POKER_BITS);
  });

  test('announces and collects authenticated peer RSA encryption keys', async () => {
    const aliceRoom = new MockGameRoom();
    const bobRoom = new MockGameRoom();
    aliceRoom.pair(bobRoom);
    aliceRoom.peerIdDeferred.resolve('alice');
    bobRoom.peerIdDeferred.resolve('bob');

    const alicePair = await generateRsaPair();
    const bobPair = await generateRsaPair();
    const alicePubJwk = await window.crypto.subtle.exportKey('jwk', alicePair.publicKey);
    const bobPubJwk = await window.crypto.subtle.exportKey('jwk', bobPair.publicKey);

    const alice = new MentalPokerGameRoom(aliceRoom, 'scope', {privateKey: alicePair.privateKey, publicKeyJwk: alicePubJwk});
    const bob = new MentalPokerGameRoom(bobRoom, 'scope', {privateKey: bobPair.privateKey, publicKeyJwk: bobPubJwk});

    await alice.announceEncryptionKey();
    await bob.announceEncryptionKey();

    // Bob collected Alice's key (and it is really Alice's: sealing with it yields
    // a ciphertext only Alice's private key can open).
    const aliceKeyAtBob = await bob.getPeerEncryptionKey('alice');
    const binding = {sender: 'bob', recipient: 'alice', round: 1, cardOffset: 5};
    const sealed = await sealCardKey({d: '7', n: '33'}, binding, aliceKeyAtBob);
    expect(await openCardKey(sealed, binding, alicePair.privateKey)).toEqual({d: '7', n: '33'});
  }, 30000);

  test('deals a private card end-to-end encrypted (recipient learns it, wire is ciphertext)', async () => {
    const rooms = [new MockGameRoom(), new MockGameRoom()];
    rooms[0].pair(rooms[1]);

    const pairs = [await generateRsaPair(), await generateRsaPair()];
    const jwks = [
      await window.crypto.subtle.exportKey('jwk', pairs[0].publicKey),
      await window.crypto.subtle.exportKey('jwk', pairs[1].publicKey),
    ];
    const mpgr = [
      new MentalPokerGameRoom(rooms[0], 'scope', {privateKey: pairs[0].privateKey, publicKeyJwk: jwks[0]}),
      new MentalPokerGameRoom(rooms[1], 'scope', {privateKey: pairs[1].privateKey, publicKeyJwk: jwks[1]}),
    ];
    rooms[0].peerIdDeferred.resolve('a');
    rooms[1].peerIdDeferred.resolve('b');

    await mpgr[0].announceEncryptionKey();
    await mpgr[1].announceEncryptionKey();

    const shuffled = [
      new Promise(resolve => mpgr[0].listener.on('shuffled', () => resolve(undefined))),
      new Promise(resolve => mpgr[1].listener.on('shuffled', () => resolve(undefined))),
    ];
    const round = await mpgr[0].startNewRound({alice: 'a', bob: 'b'});
    await shuffled[0];
    await shuffled[1];

    // 'a' learns card 0 only if it can combine its own key with b's key — and b's
    // key arrives end-to-end sealed, so a successful reveal proves opening worked.
    const aLearnsCard0 = new Promise<number>(resolve => {
      mpgr[0].listener.on('card', (_round, offset) => {
        if (offset === 0) resolve(offset);
      });
    });

    await mpgr[0].dealCard(round, 0, 'a');
    await mpgr[1].dealCard(round, 0, 'a');

    expect(await aLearnsCard0).toBe(0);

    // Every card/decrypt that b put on the wire toward a must be ciphertext only.
    const bWireCardKeys = rooms[1].eventsEmitted.filter(
      e => e.type === 'private' && (e.data as {type?: string}).type === 'card/decrypt',
    );
    expect(bWireCardKeys.length).toBeGreaterThan(0);
    for (const e of bWireCardKeys) {
      const data = e.data as {sealedKey?: string; decryptionKey?: unknown};
      expect(typeof data.sealedKey).toBe('string');
      expect(data.decryptionKey).toBeUndefined();
    }
  }, 30000);

  test('first round starts with one', async () => {
    const mockGameRoom = new MockGameRoom();
    const mentalPokerGameRoom = new MentalPokerGameRoom(mockGameRoom);

    mockGameRoom.peerIdDeferred.resolve('myid');

    const firstRound = await mentalPokerGameRoom.startNewRound({
      alice: 'alice',
      bob: 'bob',
    });
    expect(firstRound).toBe(1);
  });

  test('seconds round is two', async () => {
    const mockGameRoom = new MockGameRoom();
    const mentalPokerGameRoom = new MentalPokerGameRoom(mockGameRoom);

    mockGameRoom.peerIdDeferred.resolve('myid');

    await mentalPokerGameRoom.startNewRound({
      alice: 'alice',
      bob: 'bob',
    });
    const secondRound = await mentalPokerGameRoom.startNewRound({
      alice: 'alice',
      bob: 'bob',
    });
    expect(secondRound).toBe(2);
  });

  test('start event is emitted', async () => {
    const mockGameRoom = new MockGameRoom();
    const mentalPokerGameRoom = new MentalPokerGameRoom(mockGameRoom);

    mockGameRoom.peerIdDeferred.resolve('myid');

    const round = await mentalPokerGameRoom.startNewRound({
      alice: 'alice',
      bob: 'bob',
    });

    expect(mockGameRoom.lastEventEmitted).toMatchObject({
      type: 'public',
      sender: 'myid',
      data: {
        type: 'start',
        round,
        mentalPokerSettings: {
          alice: 'alice',
          bob: 'bob',
        },
      },
    });
  });

  test('deck is shuffled', async () => {
    const mockGameRoom = new MockGameRoom();
    const mentalPokerGameRoom = new MentalPokerGameRoom(mockGameRoom);

    mockGameRoom.peerIdDeferred.resolve('myid');

    await mentalPokerGameRoom.startNewRound({
      alice: 'myid',
      bob: 'myid',
    });

    await new Promise(resolve => {
      mentalPokerGameRoom.listener.on('shuffled', () => resolve(undefined));
    });
  }, 30000);

  test('persists the live hand per-card keys to disk and purges legacy unscoped keys', async () => {
    const mockGameRoom = new MockGameRoom();
    const mentalPokerGameRoom = new MentalPokerGameRoom(mockGameRoom, 'room-a');
    const legacyKey = 'fair-poker:individualKeys:1:myid';
    const scopedKey = 'fair-poker:individualKeys:room-a:1:myid';

    // A stale legacy (unscoped) key from an older build must be purged, never trusted.
    localStorage.setItem(legacyKey, 'legacy-persistent-key-material');
    mockGameRoom.peerIdDeferred.resolve('myid');

    await mentalPokerGameRoom.startNewRound({
      alice: 'myid',
      bob: 'myid',
    });

    await new Promise(resolve => {
      mentalPokerGameRoom.listener.on('shuffled', () => resolve(undefined));
    });

    // Legacy unscoped key is gone; the live hand's keys are persisted to
    // localStorage so an accidental close + reopen can still recover this hand.
    expect(localStorage.getItem(legacyKey)).toBeNull();
    expect(sessionStorage.getItem(legacyKey)).toBeNull();
    expect(localStorage.getItem(scopedKey)).toEqual(expect.stringContaining('"0"'));
    expect(mentalPokerGameRoom.hasIndividualKeysForRound(1)).toBe(true);
  }, 30000);

  // This is the real reproduction of the owner's "close the browser and come
  // back" case: a brand-new engine instance (empty memory) with the tab-scoped
  // sessionStorage wiped. Before keys were persisted, this lost the hand; now the
  // hand's keys survive on disk and the reopened client can keep playing — until
  // the hand ends, at which point the secrets are wiped for good.
  test('a close-and-reopen reloads the live hand keys; a wipe at hand end makes them unrecoverable', async () => {
    const mockGameRoom = new MockGameRoom();
    const mentalPokerGameRoom = new MentalPokerGameRoom(mockGameRoom, 'room-a');
    mockGameRoom.peerIdDeferred.resolve('myid');

    await mentalPokerGameRoom.startNewRound({
      alice: 'myid',
      bob: 'myid',
    });
    await new Promise(resolve => {
      mentalPokerGameRoom.listener.on('shuffled', () => resolve(undefined));
    });

    // Closing the browser wipes the tab-scoped sessionStorage; the persisted
    // localStorage copy survives.
    sessionStorage.clear();

    // Reopening = a fresh engine with empty memory, same table scope.
    const reopenedRoom = new MockGameRoom();
    reopenedRoom.peerId = 'myid';
    reopenedRoom.peerIdDeferred.resolve('myid');
    const reopened = new MentalPokerGameRoom(reopenedRoom, 'room-a');
    expect(reopened.hasIndividualKeysForRound(1)).toBe(true); // recovered from disk

    // The hand resolves → its secrets are erased from disk, for good.
    reopened.wipeRoundSecrets(1);
    expect(localStorage.getItem('fair-poker:individualKeys:room-a:1:myid')).toBeNull();

    const reopenedAgainRoom = new MockGameRoom();
    reopenedAgainRoom.peerId = 'myid';
    reopenedAgainRoom.peerIdDeferred.resolve('myid');
    const reopenedAgain = new MentalPokerGameRoom(reopenedAgainRoom, 'room-a');
    expect(reopenedAgain.hasIndividualKeysForRound(1)).toBe(false); // gone for good
  }, 30000);

  test('does not reuse card material across rooms with the same round number', async () => {
    const roomAKey = 'fair-poker:individualKeys:room-a:1:myid';
    const roomBKey = 'fair-poker:individualKeys:room-b:1:myid';
    const roomABoard = 'fair-poker:revealedBoardCards:room-a:1';
    const roomBBoard = 'fair-poker:revealedBoardCards:room-b:1';
    localStorage.setItem(roomAKey, '{"0":{"d":"11","n":"13"}}');
    localStorage.setItem(roomABoard, '{"0":{"rank":"A","suit":"spade"}}');

    const mockGameRoom = new MockGameRoom();
    const mentalPokerGameRoom = new MentalPokerGameRoom(mockGameRoom, 'room-b');
    mockGameRoom.peerIdDeferred.resolve('myid');

    mockGameRoom.listener.emit('event', {
      type: 'public',
      sender: 'myid',
      data: {
        type: 'start',
        round: 1,
        mentalPokerSettings: {
          participants: ['myid', 'other'],
        },
      },
    }, 'myid', true);

    await Promise.resolve();

    expect(localStorage.getItem(roomAKey)).toEqual('{"0":{"d":"11","n":"13"}}');
    expect(localStorage.getItem(roomABoard)).toEqual('{"0":{"rank":"A","suit":"spade"}}');
    expect(localStorage.getItem(roomBKey)).toBeNull();
    expect(localStorage.getItem(roomBBoard)).toBeNull();
  });

  test('every participant contributes to shuffle and per-card locking', async () => {
    const mockGameRoom = [
      new MockGameRoom(),
      new MockGameRoom(),
      new MockGameRoom(),
    ];
    mockGameRoom[0].pair(mockGameRoom[1]);
    mockGameRoom[0].pair(mockGameRoom[2]);
    mockGameRoom[1].pair(mockGameRoom[2]);

    const mentalPokerGameRoom = mockGameRoom.map(room => new MentalPokerGameRoom(room));

    mockGameRoom[0].peerIdDeferred.resolve('a');
    mockGameRoom[1].peerIdDeferred.resolve('b');
    mockGameRoom[2].peerIdDeferred.resolve('c');

    const shuffledDeckReceived = mentalPokerGameRoom.map(room => new Promise(resolve => {
      room.listener.on('shuffled', () => resolve(undefined));
    }));

    await mentalPokerGameRoom[0].startNewRound({
      participants: ['a', 'b', 'c'],
      bits: MIN_MENTAL_POKER_BITS,
    });

    await Promise.all(shuffledDeckReceived);

    const emittedEvents = mockGameRoom.flatMap(room => room.eventsEmitted.map(e => e.data));
    expect(emittedEvents
      .filter(event => event.type === 'deck/shuffle')
      .map(event => 'player' in event ? event.player : undefined)
    ).toEqual(['a', 'b', 'c']);
    expect(emittedEvents
      .filter(event => event.type === 'deck/lock')
      .map(event => 'player' in event ? event.player : undefined)
    ).toEqual(['a', 'b', 'c']);
    expect(emittedEvents
      .filter(event => event.type === 'deck/finalized')
      .map(event => 'player' in event ? event.player : undefined)
    ).toEqual(['c']);
  }, 60000);

  test('showing cards to oneself', async () => {
    const mockGameRoom = new MockGameRoom();
    const mentalPokerGameRoom = new MentalPokerGameRoom(mockGameRoom);

    mockGameRoom.peerIdDeferred.resolve('myid');

    const round = await mentalPokerGameRoom.startNewRound({
      alice: 'myid',
      bob: 'myid',
    });

    await new Promise(resolve => {
      mentalPokerGameRoom.listener.on('shuffled', () => resolve(undefined));
    });

    const cardShownEventPromise: Promise<[
      number,
      number,
      StandardCard,
    ]> = new Promise(resolve => {
      mentalPokerGameRoom.listener.on('card', (round, offset, card) => resolve([round, offset, card]));
    });

    await mentalPokerGameRoom.showCard(round, 0);

    const cardShownEvent = await cardShownEventPromise;

    expect(cardShownEvent[0]).toBe(round);
    expect(cardShownEvent[1]).toBe(0);

    const cardShown = cardShownEvent[2];
    expect(cardShown.suit).toBeTruthy();
    expect(cardShown.rank).toBeTruthy();
  }, 30000);

  test('dealing and showing card between two participants', async () => {
    const mockGameRoom = [
      new MockGameRoom(),
      new MockGameRoom()
    ];
    mockGameRoom[0].pair(mockGameRoom[1]);

    const mentalPokerGameRoom = [
      new MentalPokerGameRoom(mockGameRoom[0]),
      new MentalPokerGameRoom(mockGameRoom[1]),
    ];

    mockGameRoom[0].peerIdDeferred.resolve('a');
    mockGameRoom[1].peerIdDeferred.resolve('b');

    // assert both participants have received the shuffled deck
    const shuffledDeckReceived = [
      new Promise(resolve => {
        mentalPokerGameRoom[0].listener.on('shuffled', () => resolve(undefined));
      }),
      new Promise(resolve => {
        mentalPokerGameRoom[1].listener.on('shuffled', () => resolve(undefined));
      }),
    ];

    const round = await mentalPokerGameRoom[0].startNewRound({
      alice: 'a',
      bob: 'b',
    });

    await shuffledDeckReceived[0];
    await shuffledDeckReceived[1];

    // deal cards
    let cardOffsetDealtPromises: Promise<number>[] = [
      new Promise(resolve => {
        mentalPokerGameRoom[0].listener.on('card', (_round, offset, card) => resolve(offset));
      }),
      new Promise(resolve => {
        mentalPokerGameRoom[1].listener.on('card', (_round, offset, card) => resolve(offset));
      }),
    ];

    await mentalPokerGameRoom[0].dealCard(round, 0, 'a');
    await mentalPokerGameRoom[1].dealCard(round, 0, 'a');

    await mentalPokerGameRoom[0].dealCard(round, 1, 'b');
    await mentalPokerGameRoom[1].dealCard(round, 1, 'b');

    const cardOffsetsDealt = [
      await cardOffsetDealtPromises[0],
      await cardOffsetDealtPromises[1],
    ];

    expect(cardOffsetsDealt[0]).toBe(0);
    expect(cardOffsetsDealt[1]).toBe(1);

    // show cards
    const cardOffsetShownPromises: Promise<number>[] = [
      new Promise(resolve => {
        mentalPokerGameRoom[0].listener.on('card', (_round, offset, card) => resolve(offset));
      }),
      new Promise(resolve => {
        mentalPokerGameRoom[1].listener.on('card', (_round, offset, card) => resolve(offset));
      }),
    ];

    await mentalPokerGameRoom[0].showCard(round, 2);
    await mentalPokerGameRoom[1].showCard(round, 2);

    const cardOffsetsShown = [
      await cardOffsetShownPromises[0],
      await cardOffsetShownPromises[1],
    ];

    expect(cardOffsetsShown[0]).toBe(2);
    expect(cardOffsetsShown[1]).toBe(2);
  }, 60000);

  test('ignores decrypt keys claimed for another participant', async () => {
    const mockGameRoom = [
      new MockGameRoom(),
      new MockGameRoom()
    ];
    mockGameRoom[0].pair(mockGameRoom[1]);

    const mentalPokerGameRoom = [
      new MentalPokerGameRoom(mockGameRoom[0]),
      new MentalPokerGameRoom(mockGameRoom[1]),
    ];

    mockGameRoom[0].peerIdDeferred.resolve('a');
    mockGameRoom[1].peerIdDeferred.resolve('b');

    const shuffledDeckReceived = [
      new Promise(resolve => {
        mentalPokerGameRoom[0].listener.on('shuffled', () => resolve(undefined));
      }),
      new Promise(resolve => {
        mentalPokerGameRoom[1].listener.on('shuffled', () => resolve(undefined));
      }),
    ];

    const round = await mentalPokerGameRoom[0].startNewRound({
      alice: 'a',
      bob: 'b',
    });

    await shuffledDeckReceived[0];
    await shuffledDeckReceived[1];

    await mockGameRoom[0].emitEvent({
      type: 'private',
      sender: 'a',
      recipient: 'a',
      data: {
        type: 'card/decrypt',
        round,
        cardOffset: 0,
        player: 'b',
        decryptionKey: {
          d: '1',
          n: '2',
        },
      },
    });

    const cardDealt = new Promise<boolean>(resolve => {
      mentalPokerGameRoom[0].listener.on('card', () => resolve(true));
    });

    await mentalPokerGameRoom[0].dealCard(round, 0, 'a');
    await mentalPokerGameRoom[1].dealCard(round, 0, 'a');

    await expect(Promise.race([
      cardDealt,
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 2000)),
    ])).resolves.toBe(true);
  }, 60000);
});
