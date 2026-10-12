#!/usr/bin/env bash
# Upload a built CLI release (scripts/release-cli.sh) to GitHub as cli-v<version>.
#
#   scripts/publish-cli-release.sh            # draft: nothing public yet
#   scripts/publish-cli-release.sh --publish  # public: the installers pick it up
#
# install.sh and install.ps1 install the newest stable (non-draft,
# non-prerelease) cli-v* release, so a draft can be checked (download it,
# run scripts/test-install.sh on it) before anyone can install it.
# Publishing a draft later:
#   gh release edit cli-v<version> --draft=false --latest
# The release is marked "latest": when GitHub's API rate-limits an install,
# the installers fall back to the repository's latest-release redirect.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
VERSION=$(sed -n '/^\[workspace.package\]/,/^\[/s/^version = "\(.*\)"/\1/p' "$ROOT/Cargo.toml")
TAG="cli-v$VERSION"
DIST="$ROOT/dist/cli/v$VERSION"
draft=(--draft)
[ "${1:-}" = --publish ] && draft=()

[ -f "$DIST/SHA256SUMS" ] || { echo "no build in $DIST; run scripts/release-cli.sh" >&2; exit 1; }

# The binaries must come from the commit the tag names, and that commit
# must be on main, so anyone can rebuild and compare what they install.
HEAD_COMMIT=$(git -C "$ROOT" rev-parse HEAD)
[ -z "$(git -C "$ROOT" status --porcelain)" ] || { echo "uncommitted changes; publish from a clean checkout of main" >&2; exit 1; }
git -C "$ROOT" fetch -q origin main
git -C "$ROOT" merge-base --is-ancestor "$HEAD_COMMIT" origin/main ||
	{ echo "HEAD ($HEAD_COMMIT) is not on origin/main; merge first, then build and publish from main" >&2; exit 1; }
built=$(cat "$DIST/COMMIT" 2>/dev/null || true)
[ "$built" = "$HEAD_COMMIT" ] ||
	{ echo "$DIST was built from ${built:-an unknown commit}, not HEAD ($HEAD_COMMIT); run scripts/release-cli.sh again" >&2; exit 1; }
(cd "$DIST" && sha256sum -c --quiet SHA256SUMS) || { echo "SHA256SUMS does not match $DIST" >&2; exit 1; }
if gh release view "$TAG" >/dev/null 2>&1; then
	echo "$TAG already exists; bump the workspace version in Cargo.toml for a new release" >&2
	exit 1
fi

notes=$(mktemp)
trap 'rm -f "$notes"' EXIT
cat >"$notes" <<EOF
The BridgeHook CLI: a permanent webhook URL for a local port, with webhooks that arrive while it is stopped delivered in order when it starts.

**Install**

\`\`\`sh
curl -fsSL https://bridgehook.dev/install.sh | sh        # macOS, Linux
\`\`\`

\`\`\`powershell
irm https://bridgehook.dev/install.ps1 | iex             # Windows
\`\`\`

Both check the download is intact against \`SHA256SUMS\` below and install nothing if it does not match. Then:

\`\`\`sh
bridgehook login
bridgehook forward 3000
\`\`\`

| Asset | Platform |
|---|---|
| \`bridgehook-x86_64-unknown-linux-musl\` | Linux x86_64 (static) |
| \`bridgehook-aarch64-unknown-linux-musl\` | Linux arm64 (static) |
| \`bridgehook-x86_64-apple-darwin\` | macOS Intel |
| \`bridgehook-aarch64-apple-darwin\` | macOS Apple silicon |
| \`bridgehook-x86_64-pc-windows-gnu.exe\` | Windows x64 (also runs on Windows on ARM) |
EOF

gh release create "$TAG" "${draft[@]}" \
	--title "bridgehook CLI v$VERSION" \
	--latest \
	--notes-file "$notes" \
	--target "$HEAD_COMMIT" \
	"$DIST"/bridgehook-* "$DIST/SHA256SUMS"
