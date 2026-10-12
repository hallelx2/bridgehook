#!/usr/bin/env bash
# Build the bridgehook CLI for every released platform and write SHA256SUMS.
#
#   scripts/release-cli.sh            # -> dist/cli/v<version>/
#
# Cross-compiles in the cargo-zigbuild container (Linux musl, macOS with its
# SDK, Windows), so one Linux machine with Docker builds all five. Release
# assets are bare binaries, which install.sh and install.ps1 download and
# check against SHA256SUMS:
#
#   bridgehook-x86_64-unknown-linux-musl
#   bridgehook-aarch64-unknown-linux-musl
#   bridgehook-x86_64-apple-darwin
#   bridgehook-aarch64-apple-darwin
#   bridgehook-x86_64-pc-windows-gnu.exe
#
# OFFLINE=1 builds from the crates already in ~/.cargo (no network in the
# container). Publish with scripts/publish-cli-release.sh, which only takes
# a build of a clean, pushed commit on main; the commit is recorded in
# dist/cli/v<version>/COMMIT. ALLOW_DIRTY=1 builds uncommitted changes for a
# local try (such a build cannot be published).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
IMAGE=${CARGO_ZIGBUILD_IMAGE:-ghcr.io/rust-cross/cargo-zigbuild:latest}
TARGETS=(
	x86_64-unknown-linux-musl
	aarch64-unknown-linux-musl
	x86_64-apple-darwin
	aarch64-apple-darwin
	x86_64-pc-windows-gnu
)

if [ -n "$(git -C "$ROOT" status --porcelain)" ] && [ "${ALLOW_DIRTY:-0}" != 1 ]; then
	echo "the tree has uncommitted changes; commit them (or ALLOW_DIRTY=1 for a local try)" >&2
	exit 1
fi
COMMIT=$(git -C "$ROOT" rev-parse HEAD)
[ -z "$(git -C "$ROOT" status --porcelain)" ] || COMMIT="$COMMIT-dirty"

VERSION=$(sed -n '/^\[workspace.package\]/,/^\[/s/^version = "\(.*\)"/\1/p' "$ROOT/Cargo.toml")
[ -n "$VERSION" ] || { echo "no workspace version in Cargo.toml" >&2; exit 1; }
OUT="$ROOT/dist/cli/v$VERSION"
rm -rf "$OUT"
mkdir -p "$OUT"

CARGO_HOME_HOST=${CARGO_HOME:-$HOME/.cargo}
mkdir -p "$CARGO_HOME_HOST"
docker_args=(
	--rm
	-u "$(id -u):$(id -g)"
	-v "$ROOT:/src"
	-v "$CARGO_HOME_HOST:/cargo"
	-e CARGO_HOME=/cargo
	-e CARGO_TARGET_DIR=/src/target/cross
	-e ZIG_GLOBAL_CACHE_DIR=/src/target/cross/zig-cache
	-e HOME=/tmp
	-w /src
)
offline=()
if [ "${OFFLINE:-0}" = 1 ]; then
	docker_args+=(--network none)
	offline=(--offline)
fi

for target in "${TARGETS[@]}"; do
	echo "==> $target"
	docker run "${docker_args[@]}" "$IMAGE" \
		cargo zigbuild --locked "${offline[@]}" --release -p bridgehook --target "$target"
	src="$ROOT/target/cross/$target/release/bridgehook"
	name="bridgehook-$target"
	case $target in *windows*) src="$src.exe"; name="$name.exe" ;; esac
	cp "$src" "$OUT/$name"
done

(cd "$OUT" && sha256sum bridgehook-* > SHA256SUMS)
echo "$COMMIT" > "$OUT/COMMIT"
echo
echo "v$VERSION (commit $COMMIT):"
for f in "$OUT"/bridgehook-*; do
	printf '%10s  %s\n' "$(wc -c <"$f")" "${f##*/}"
done
cat "$OUT/SHA256SUMS"
