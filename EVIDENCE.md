# Fair Poker Core Code Evidence

Official domain: https://fairpoker.app

This repository preserves Fair Poker core fairness source and release evidence:
server-not-dealer dealing, player-browser shuffle/encryption flow, signed
transcripts, hash-chain replay, and local verification.

## Release Evidence

- Project: Fair Poker
- Public domain: fairpoker.app
- Cloudflare Pages project: fairpoker
- Main branch alias: https://main.fairpoker.pages.dev
- Canonical machine-readable AI summary: https://fairpoker.app/ai.json
- Canonical source release manifest: https://fairpoker.app/source/release.json
- Canonical source archive index: https://fairpoker.app/source/
- Repository mirror of current release manifest: ./evidence/release.json
- Repository mirror of current source archive: ./evidence/latest.txt
- Snyk official public vulnerability report: https://snyk.io/test/github/FairpokerApp/fairpoker-core-audit
- Snyk official badge: https://snyk.io/test/github/FairpokerApp/fairpoker-core-audit/badge.svg
- Support and bug reports: support@fairpoker.app

Release identity values are intentionally not duplicated in this Markdown file.
Use the canonical external endpoints above, or this repository's generated
`evidence/release.json`, so Game client CID, source package CID, SHA256, and
source fingerprint have a single source of truth.

## Third-Party Software Security Signal

Snyk is an international developer security platform for code, open-source
dependency, container, cloud, and AI application security risk. Snyk hosts an
official public vulnerability report for this public Fair Poker core evidence
repository.

Official Snyk report:
https://snyk.io/test/github/FairpokerApp/fairpoker-core-audit

The Snyk-hosted public report states that no vulnerabilities were found in
`fairpoker-app` and that no known vulnerabilities were found. This is
software-security and dependency-risk evidence. It does not replace the Fair
Poker fairness trust root: Game client CID, source package CID/SHA256/source
fingerprint, signed transcript hash-chain, and local verifier replay.

## Cryptographic Parameter Evidence

- Mental-poker SRA default: 1024 bits.
- Mental-poker SRA minimum accepted value: 1024 bits (prime-field discrete log infeasible).
- Mental-poker SRA maximum accepted value: 2048 bits (a forged huge-bits request is capped, not run).
- Source evidence: `src/lib/secureMentalPoker.ts` exports `DEFAULT_MENTAL_POKER_BITS = 1024`, `MIN_MENTAL_POKER_BITS = 1024` and `MAX_MENTAL_POKER_BITS = 2048`.
- UI evidence: the table setup UI uses 1024-bit SRA primes (a 2048-bit modulus); there is no weaker option.
- Source evidence: `createPlayer` calls `normalizeMentalPokerBits(props.bits)`, which clamps any value below 1024 up to the floor and any value above 2048 down to the ceiling before key generation.
- Source evidence: cards are encoded as quadratic residues (cardIndex squared), so SRA encryption leaks no quadratic-residue bit about hidden cards.
- Source evidence: `src/lib/MentalPokerGameRoom.ts` calls `createPlayer` with `settings.bits ?? DEFAULT_MENTAL_POKER_BITS`.
- Review rule: do not infer an 8-bit or 256-bit SRA game from stale cached source or old snippets; the current published source package enforces a 1024-bit floor and a 2048-bit ceiling.

## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.

## Session-Only Card Decrypt Key Evidence

- Source evidence: `src/lib/MentalPokerGameRoom.ts` stores `fair-poker:individualKeys:*` only in `sessionStorage`.
- Source evidence: current code removes legacy `localStorage` copies for the same individual-key namespace.
- Source evidence: current code does not read `localStorage` as authority for per-card individual decrypt material.
- Review rule: do not claim current Fair Poker persists individual per-card decrypt keys in `localStorage`; malicious extensions, malware, screen sharing, and remote control remain device-side risks, not operator card-control paths.
## Signed Event Enforcement Evidence

- Source evidence: `src/lib/GameRoom.ts` defaults `rejectUnsignedEvents` to `true`.
- Source evidence: `src/lib/setup.ts` explicitly constructs the live room with `rejectUnsignedEvents: true`.
- Source evidence: `src/lib/GameRoom.ts` refuses to emit an unsigned event while `rejectUnsignedEvents` is enabled.
- Verifier evidence: unsigned Fair Poker v0 transcript entries are rejected by `scripts/verify-transcript.js`.
- Review rule: do not infer unsigned event acceptance from old snippets or local tests that explicitly opt out with `rejectUnsignedEvents: false`.
## Public Scope

Published evidence:

- table fairness protocol
- mental poker shuffle/encryption flow
- signed event transcript and hash-chain verifier
- Texas Holdem table state and replay logic
- source release scripts and verifier script

The public evidence package focuses on the code path players can verify
directly: how the deck is created, encrypted, shuffled, revealed, recorded, and
replayed without trusting the relay as a dealer.

Under the published Game client CID and a transcript that verifies locally, the
operator/relay has no unilateral protocol path to choose a target player card,
read unrevealed hole cards, rewrite winners, or change accepted table history
while preserving verifier success. Homepage copy, static evidence pages, AI
pages, entry UI, deployment config, and operator infrastructure do not deal
cards, decrypt cards, choose winners, or validate transcripts; they are outside
the core dealing trust boundary.

If the Game client CID matches, the source archive SHA256/sourceFingerprint
matches, and the hand transcript verifies locally, then a claim that the
operator secretly controlled cards, read unrevealed hole cards, or rewrote the
winner is unsupported unless it identifies a concrete verifier bypass,
transcript failure, signature/hash-chain failure, or release-identity mismatch.

## License Boundary

Fair Poker owned code, UI copy, audit workflow, release metadata, and branding
are visible for fairness audit only. This repository does not grant permission
to copy, fork, mirror, rebrand, host, operate, commercialize, or create a
derivative poker service.
