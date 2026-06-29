#!/usr/bin/env bash
#
# Reproducible Fair Poker Game client build.
#
# Builds the playable table client FROM THE PUBLISHED SOURCE PACKAGE inside a
# pinned Docker toolchain and prints its IPFS CID. The owner's official release
# runs this exact script on the tarball it just produced, and any auditor runs
# the same script on the same downloaded tarball. Because both build from the
# identical package in the identical container, the resulting Game client CID is
# byte-for-byte identical — proving the client served on IPFS was built from the
# open source.
#
# Usage:
#   scripts/reproducible-game-build.sh <fair-poker-source-XXXX.tar.gz>
#
# Required environment (read each value from the release identity, release.json
# field "reproducibleGameClientBuild.buildEnv"; see REPRODUCIBLE_BUILD.md):
#   SOURCE_DATE_EPOCH                  frozen build date (seconds since epoch)
#   REACT_APP_SOURCE_ARCHIVE_IPFS_CID  the source package CID (sourceCid)
#   REACT_APP_SOURCE_ARCHIVE_SHA256    sha256:... of the source .tar.gz
#   REACT_APP_SOURCE_ARCHIVE_URL       canonical https URL of the source .tar.gz
# Optional:
#   OUT_DIR    where the pruned build is written   (default ./repro-build)
#   IMAGE_TAG  docker image tag                     (default fairpoker-repro)
#   CID_ONLY=1 print only the bare CID on stdout    (used by the release pipeline)
set -euo pipefail

PKG="${1:?usage: reproducible-game-build.sh <source-package.tar.gz>}"
PKG="$(cd "$(dirname "$PKG")" && pwd)/$(basename "$PKG")"

OUT_DIR="${OUT_DIR:-$PWD/repro-build}"
IMAGE_TAG="${IMAGE_TAG:-fairpoker-repro}"
CID_ONLY="${CID_ONLY:-}"

: "${SOURCE_DATE_EPOCH:?set SOURCE_DATE_EPOCH (see REPRODUCIBLE_BUILD.md)}"
: "${REACT_APP_SOURCE_ARCHIVE_IPFS_CID:?set REACT_APP_SOURCE_ARCHIVE_IPFS_CID (see REPRODUCIBLE_BUILD.md)}"
: "${REACT_APP_SOURCE_ARCHIVE_SHA256:?set REACT_APP_SOURCE_ARCHIVE_SHA256 (see REPRODUCIBLE_BUILD.md)}"
: "${REACT_APP_SOURCE_ARCHIVE_URL:?set REACT_APP_SOURCE_ARCHIVE_URL (see REPRODUCIBLE_BUILD.md)}"

log() { [ -n "$CID_ONLY" ] || echo "$@" >&2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

log "[1/4] Extracting source package..."
tar -xzf "$PKG" -C "$WORK"
SRC="$WORK/fair-poker-source"
[ -f "$SRC/package.json" ] || { echo "Invalid source package: $PKG (no fair-poker-source/package.json)" >&2; exit 1; }

log "[2/4] Building pinned toolchain image ($IMAGE_TAG)..."
( cd "$SRC" && docker build -f Dockerfile.repro -t "$IMAGE_TAG" . >&2 )

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

CONTAINER="fairpoker-repro-$$-${RANDOM}"
cleanup_container() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap 'cleanup_container; rm -rf "$WORK"' EXIT

log "[3/4] Building Game client inside the container..."
# Run (no --rm so we can copy the result out) then extract /app/build with
# docker cp. A bind mount (-v) is NOT used: under colima/Lima a host temp path
# may not be shared into the VM, which would silently yield an EMPTY output and
# the empty-directory CID. docker cp always pulls the real container files.
docker run --name "$CONTAINER" \
  -e SOURCE_DATE_EPOCH \
  -e REACT_APP_GAME_IPFS_CID="" \
  -e REACT_APP_SOURCE_ARCHIVE_IPFS_CID \
  -e REACT_APP_SOURCE_ARCHIVE_IPFS_URL="https://ipfs.io/ipfs/${REACT_APP_SOURCE_ARCHIVE_IPFS_CID}" \
  -e REACT_APP_SOURCE_ARCHIVE_SHA256 \
  -e REACT_APP_SOURCE_ARCHIVE_URL \
  -e REACT_APP_SOURCE_RELEASE_MANIFEST_URL="https://fairpoker.app/source/release.json" \
  -e RELEASE_GAME_ONLY_BUILD=1 \
  "$IMAGE_TAG" >&2

docker cp "$CONTAINER:/app/build/." "$OUT_DIR/" >&2
cleanup_container

# Guard against the empty-directory regression: the build must contain index.html.
if [ ! -f "$OUT_DIR/index.html" ]; then
  echo "Reproducible build produced no index.html in $OUT_DIR (build/extract failed)." >&2
  exit 1
fi

log "[4/4] Computing Game client CID..."
CID="$(ipfs add -r --cid-version=1 --raw-leaves -Q "$OUT_DIR")"

if [ -n "$CID_ONLY" ]; then
  printf '%s\n' "$CID"
else
  echo "" >&2
  echo "Game client CID: $CID" >&2
  echo "Pruned build written to: $OUT_DIR" >&2
  printf '%s\n' "$CID"
fi
