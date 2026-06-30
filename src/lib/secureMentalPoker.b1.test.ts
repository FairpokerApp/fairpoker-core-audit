// Round-3 B-1: the SRA modulus is validated on receipt, so a weak/composite/smooth-order
// modulus (which would let the first shuffler read every hole card) is rejected, while a sound
// modulus (two large primes each carrying a verifiable large prime factor in p-1) is accepted.
//
// This is a pure VALIDATION unit test over PRECOMPUTED vectors — it deliberately does NOT run the
// real 1024-bit generator. (Generating fresh moduli with the async worker-thread prime() leaked
// into later in-band suites and intermittently broke an unrelated UI test; the real generator is
// exercised end-to-end by the realcrypto-allin-refresh integration tests instead.)

import { bitLength } from 'bigint-crypto-utils';
import { assertSoundModulus, isSoundModulusPrime, MIN_MENTAL_POKER_BITS } from './secureMentalPoker';

const BITS = MIN_MENTAL_POKER_BITS; // 1024

// Two distinct SOUND moduli primes: p = k·q' + 1 with a small even k and a ~1008-bit prime q', so
// p-1 carries the verifiable large prime factor q' (precomputed; structure proven by the validator).
const SOUND_P = BigInt('91410541737636526293344825727102396922783024731888062068075900758841624929420420837043054911370076422902462238577164251849594839772991237624113920939292558649210789895348245568950317553407323805020237075620742031307918143305079328798787367345383781283121022356481116939586498662955026411766318084451253802703');
const SOUND_Q = BigInt('92154652297168895078205447702205554431065890121409574924025625370854266190326212589644282606956091883636446410136024424076027079825840578557133942606422837959710391074761428078870372126105932462874538923829452733387283375321172257615672992292460413526847677531642536213305561289475671955754163530518223884647');
// A LARGE prime whose order is SMOOTH: p-1 = 2^824 · r with r only ~200 bits — passes size and
// primality, but its hard subgroup is far below the 256-bit floor, so it must be rejected.
const SMOOTH_P = BigInt('151115661609344685325289446773532141300014680620898653132382938629816693838446429457394062507694768727455919540080219089286244077812524398894553459289414902181325384097172231777625279041564259557872575634492753300957580834271201323316023233094572902822214716628686584113842785283034927968343971831704849481729');

test('B-1: the auditor PoC {p:15, q:21} is rejected', async () => {
  await expect(assertSoundModulus(BigInt(15), BigInt(21), BITS)).rejects.toThrow();
});

test('B-1: a large COMPOSITE modulus prime is rejected', async () => {
  expect(await isSoundModulusPrime(BigInt(1) << BigInt(1025), BITS)).toBe(false); // 2^1025, composite
});

test('B-1: a LARGE prime with a smooth order (no big prime factor in p-1) is rejected', async () => {
  expect(bitLength(SMOOTH_P)).toBe(BITS);
  expect(await isSoundModulusPrime(SMOOTH_P, BITS)).toBe(false); // smooth order ⇒ rejected
});

test('B-1: equal primes (p === q) are rejected', async () => {
  await expect(assertSoundModulus(SOUND_P, SOUND_P, BITS)).rejects.toThrow();
});

test('B-1: a sound modulus (two large primes with verifiable large prime factors) is accepted', async () => {
  expect(bitLength(SOUND_P)).toBe(BITS);
  expect(bitLength(SOUND_Q)).toBe(BITS);
  expect(await isSoundModulusPrime(SOUND_P, BITS)).toBe(true);
  await expect(assertSoundModulus(SOUND_P, SOUND_Q, BITS)).resolves.toBeUndefined();
});
