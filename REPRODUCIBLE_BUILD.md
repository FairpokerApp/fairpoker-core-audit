# Reproducing the Fair Poker Game client CID

This document lets anyone independently rebuild the **playable Game client** from
this published source package and confirm that the result is **byte-for-byte
identical** to the Game client CID served on IPFS. A match proves the client
running on IPFS was built from exactly this open source — not from some hidden,
different code.

There are two different IPFS CIDs, and they are **not** meant to be equal:

| CID | What it is |
|-----|-----------|
| **Source package CID** (`sourceCid`) | the `.tar.gz` you downloaded (this source) |
| **Game client CID** (`gameClientCid`) | the compiled, playable table client |

You **cannot** turn a source archive into a compiled build by hashing — they are
different artifacts. Instead you *rebuild* the source and check that the rebuilt
**Game client CID equals the published `gameClientCid`**. That is what this guide
does.

## What you need

- Docker (any recent version; Docker Desktop, colima, etc.)
- The IPFS CLI (`ipfs`, e.g. Kubo) to compute the final CID
- This source package: `fair-poker-source-XXXX.tar.gz`

The build itself runs inside a **pinned Docker image** (Node pinned by digest in
`Dockerfile.repro`) with `npm ci` against the committed `package-lock.json`, so
your toolchain matches the official one regardless of your host OS.

## Step 1 — Verify you have the genuine source

```sh
# The sha256 must equal release.json's "archiveSha256" (and the .sha256 file).
shasum -a 256 fair-poker-source-XXXX.tar.gz

# Optional: confirm the source package CID matches the published sourceCid.
ipfs add -rQ --cid-version=1 --raw-leaves --only-hash fair-poker-source-XXXX.tar.gz
```

## Step 2 — Read the build inputs from `release.json`

Open `release.json` (published at `https://fairpoker.app/source/release.json`)
and find `reproducibleGameClientBuild.buildEnv`. It lists the exact values to
use. They are all public and derivable from the source archive itself:

- `SOURCE_DATE_EPOCH` — frozen build timestamp for this release
- `REACT_APP_SOURCE_ARCHIVE_IPFS_CID` — this package's `sourceCid`
- `REACT_APP_SOURCE_ARCHIVE_SHA256` — `sha256:...` of this package
- `REACT_APP_SOURCE_ARCHIVE_URL` — canonical URL of this package

## Step 3 — Rebuild the Game client

```sh
tar -xzf fair-poker-source-XXXX.tar.gz
cd fair-poker-source

export SOURCE_DATE_EPOCH=<from release.json>
export REACT_APP_SOURCE_ARCHIVE_IPFS_CID=<from release.json>
export REACT_APP_SOURCE_ARCHIVE_SHA256=<from release.json>
export REACT_APP_SOURCE_ARCHIVE_URL=<from release.json>

bash scripts/reproducible-game-build.sh ../fair-poker-source-XXXX.tar.gz
```

The script prints the rebuilt **Game client CID**.

## Step 4 — Compare

Compare the printed CID to the official `gameClientCid` (shown on the site's
verification panel, in `ai.json`, and in `release.json`). **If they are equal,
reproduction succeeded**: the IPFS Game client was built from this exact source.

## How the CID is computed (what the script does)

1. Extracts the source package into a clean directory.
2. Builds the pinned Docker image (`Dockerfile.repro`) and runs `npm ci`.
3. Runs `npm run build:repro` — generates the two deterministic in-bundle files
   (`src/generated/releaseMetadata.ts`, `src/generated/auditStatus.ts`) and then
   `react-scripts build`.
4. Runs `node scripts/create-ipfs-game-build.js` to prune the build down to the
   **playable client only** (homepage / AI / evidence / legal pages and other
   website content are removed — they are not part of the Game client CID).
5. `ipfs add -r --cid-version=1 --raw-leaves -Q <pruned build>` → the CID.

## Determinism notes

- `SOURCE_DATE_EPOCH` (reproducible-builds.org standard) freezes the only
  timestamp that reaches the bundle, so rebuilds are stable over time.
- `GENERATE_SOURCEMAP=false` (in `.env.production`) keeps source maps out.
- The Docker base image is pinned by **digest** in `Dockerfile.repro`; the build
  is pure JavaScript output and is not sensitive to CPU architecture.
- The build never contacts a Fair Poker server; it only needs npm (for `npm ci`)
  and the pinned image.

## License

This source is provided under the Fair Poker Source-Available License
(`FAIR_POKER_LICENSE.md`): you may inspect, audit, and reproduce builds, but you
may **not** operate, rebrand, or commercialize Fair Poker or a derivative.
