#!/usr/bin/env bash
# Run apps/web/public/install.sh in clean containers against a local mirror
# of a release (scripts/release-cli.sh output), with no internet access.
#
#   scripts/test-install.sh [dist/cli/v<version>]
#
# The mirror also stands in for GitHub (BRIDGEHOOK_GITHUB_URL and
# BRIDGEHOOK_GITHUB_API_URL): a releases API whose newest entry is a
# prerelease, then a non-CLI release, then the stable CLI release (pretty
# and minified JSON); a rate-limited API (403) with GitHub's latest-release
# redirect to fall back on; and a redirect to a non-CLI release.
#
# Checks: install on glibc (curl) and musl (busybox wget); the installed
# binary runs; re-running upgrades in place; a tampered binary or a missing
# SHA256SUMS entry aborts with nothing installed; the PATH hint appears when
# the install directory is not on PATH. install.ps1 runs the same way
# (`Get-Content | Invoke-Expression`, as `irm | iex` does) in the PowerShell
# container: it cannot run the .exe or write the Windows registry there, so
# it checks the download, the checksum, the installed file's hash and the
# atomic replace.
# shellcheck disable=SC2016 # single-quoted test and container scripts are
# expanded later on purpose (by expect's bash, or the container's shell)
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
if [ $# -ge 1 ]; then
	DIST=$1
else
	DIST=$(find "$ROOT/dist/cli" -mindepth 1 -maxdepth 1 -type d -name 'v*' | sort -V | tail -n 1)
fi
[ -f "$DIST/SHA256SUMS" ] || { echo "no release in $DIST; run scripts/release-cli.sh" >&2; exit 1; }
INSTALL_SH="$ROOT/apps/web/public/install.sh"
NET=bh-install-test
MIRROR=bh-install-mirror
# Under target/, not /tmp: /tmp is often a small tmpfs with a quota.
mkdir -p "$ROOT/target"
MIRRORS=$(mktemp -d "$ROOT/target/install-test.XXXXXX")
pass=0
fail=0

cleanup() {
	docker rm -f "$MIRROR" >/dev/null 2>&1 || true
	docker network rm "$NET" >/dev/null 2>&1 || true
	rm -rf "$MIRRORS"
}
trap cleanup EXIT
cleanup

# expect <name> <output> <bash test over $out>: records a pass or a failure,
# printing the output on failure.
expect() {
	local name=$1 out=$2 test=$3
	if out=$out bash -c "$test"; then
		echo "  ok   $name"
		pass=$((pass + 1))
	else
		echo "  FAIL $name"
		printf '%s\n' "$out" | while IFS= read -r line; do printf '       %s\n' "$line"; done
		fail=$((fail + 1))
	fi
}

# Mirrors: /good is the release as built; /tampered has a modified Linux
# binary under the original checksums; /unlisted has SHA256SUMS without it.
mkdir -p "$MIRRORS/good" "$MIRRORS/tampered" "$MIRRORS/unlisted"
cp "$DIST"/* "$MIRRORS/good/"
cp "$DIST"/* "$MIRRORS/tampered/"
printf 'x' >> "$MIRRORS/tampered/bridgehook-x86_64-unknown-linux-musl"
printf 'x' >> "$MIRRORS/tampered/bridgehook-x86_64-pc-windows-gnu.exe"
cp "$DIST"/* "$MIRRORS/unlisted/"
grep -v -e 'x86_64-unknown-linux-musl' -e 'x86_64-pc-windows-gnu' "$DIST/SHA256SUMS" > "$MIRRORS/unlisted/SHA256SUMS"

# The stand-in GitHub: releases API fixtures and redirects.
VERSION=$(basename "$DIST")
VERSION=${VERSION#v}
mkdir -p "$MIRRORS/fixtures"
cat >"$MIRRORS/fixtures/releases.json" <<EOF
[
  {
    "url": "https://api.github.com/repos/hallelx2/bridgehook/releases/3",
    "author": { "login": "hallelx2", "id": 1, "type": "User" },
    "tag_name": "cli-v9.9.9-rc1",
    "name": "bridgehook CLI v9.9.9-rc1, with a comma",
    "draft": false,
    "prerelease": true,
    "assets": []
  },
  {
    "url": "https://api.github.com/repos/hallelx2/bridgehook/releases/2",
    "author": { "login": "hallelx2", "id": 1, "type": "User" },
    "tag_name": "v0.0.1",
    "name": "extension",
    "draft": false,
    "prerelease": false,
    "assets": []
  },
  {
    "url": "https://api.github.com/repos/hallelx2/bridgehook/releases/1",
    "author": { "login": "hallelx2", "id": 1, "type": "User" },
    "tag_name": "cli-v$VERSION",
    "name": "bridgehook CLI v$VERSION",
    "draft": false,
    "prerelease": false,
    "assets": [ { "name": "SHA256SUMS" } ]
  }
]
EOF
tr -d '\n' <"$MIRRORS/fixtures/releases.json" | tr -s ' ' >"$MIRRORS/fixtures/releases.min.json"
NGINX_CONF="$MIRRORS/nginx.conf"
cat >"$NGINX_CONF" <<EOF
server {
	listen 80;
	root /usr/share/nginx/html;
	location = /api/repos/hallelx2/bridgehook/releases { default_type application/json; alias /usr/share/nginx/html/fixtures/releases.json; }
	location = /api-min/repos/hallelx2/bridgehook/releases { default_type application/json; alias /usr/share/nginx/html/fixtures/releases.min.json; }
	location /api-limited/ { default_type application/json; return 403 '{"message":"API rate limit exceeded"}'; }
	location = /gh/hallelx2/bridgehook/releases/latest { return 302 http://\$host/gh/hallelx2/bridgehook/releases/tag/cli-v$VERSION; }
	location = /gh-other/hallelx2/bridgehook/releases/latest { return 302 http://\$host/gh-other/hallelx2/bridgehook/releases/tag/v0.0.1; }
	location /gh/hallelx2/bridgehook/releases/download/cli-v$VERSION/ { alias /usr/share/nginx/html/good/; }
}
EOF
chmod -R a+rX "$MIRRORS"

docker network create --internal "$NET" >/dev/null
docker run -d --name "$MIRROR" --network "$NET" -v "$MIRRORS:/usr/share/nginx/html:ro" \
	-v "$NGINX_CONF:/etc/nginx/conf.d/default.conf:ro" nginx:alpine >/dev/null
for _ in $(seq 30); do
	docker exec "$MIRROR" wget -qO- http://localhost/good/SHA256SUMS >/dev/null 2>&1 && break
	sleep 0.5
done

# run <image> <mirror path> <commands run in the container, where the
# installer is /install.sh>. The commands are a literal script for the
# container's shell, so its variables are expanded there.
run() {
	docker run --rm --network "$NET" -v "$INSTALL_SH:/install.sh:ro" \
		-e BRIDGEHOOK_DOWNLOAD_URL="http://$MIRROR/$2" -e BRIDGEHOOK_VERSION=test \
		--entrypoint sh "$1" -c "$3" 2>&1 || true
}

# ghrun <image> <github path> <api path> <commands>: install.sh resolving
# the version from the stand-in GitHub (no BRIDGEHOOK_DOWNLOAD_URL).
ghrun() {
	docker run --rm --network "$NET" -v "$INSTALL_SH:/install.sh:ro" \
		-e BRIDGEHOOK_GITHUB_URL="http://$MIRROR/$2" -e BRIDGEHOOK_GITHUB_API_URL="http://$MIRROR/$3" \
		--entrypoint sh "$1" -c "$4" 2>&1 || true
}

for image in rust:1-trixie nginx:alpine; do
	echo "== $image"
	out=$(run "$image" good 'sh /install.sh && ~/.local/bin/bridgehook --version')
	expect "installs and runs" "$out" 'grep -q "^bridgehook [0-9]" <<<"$out"'
	expect "PATH hint when ~/.local/bin is not on PATH" "$out" 'grep -q "is not on your PATH" <<<"$out"'

	out=$(run "$image" good 'sh /install.sh >/dev/null && sh /install.sh && ls -a ~/.local/bin')
	expect "re-running upgrades in place, no staged files left" "$out" \
		'grep -q "Installed bridgehook" <<<"$out" && ! grep -q "\.bridgehook\.new" <<<"$out"'

	out=$(run "$image" good 'mkdir -p /opt/bh && PATH=/opt/bh:$PATH BRIDGEHOOK_INSTALL_DIR=/opt/bh sh /install.sh && /opt/bh/bridgehook --version')
	expect "BRIDGEHOOK_INSTALL_DIR, no hint when on PATH" "$out" \
		'grep -q "^bridgehook [0-9]" <<<"$out" && ! grep -q "not on your PATH" <<<"$out"'

	out=$(run "$image" tampered 'sh /install.sh; echo "exit=$?"; ls ~/.local/bin 2>/dev/null | wc -l')
	expect "tampered binary aborts, nothing installed" "$out" \
		'grep -q "checksum mismatch" <<<"$out" && grep -q "exit=1" <<<"$out" && [ "$(tail -n 1 <<<"$out" | tr -d " ")" = 0 ]'

	out=$(run "$image" unlisted 'sh /install.sh; echo "exit=$?"')
	expect "binary missing from SHA256SUMS aborts" "$out" \
		'grep -q "not listed in SHA256SUMS" <<<"$out" && grep -q "exit=1" <<<"$out"'

	out=$(ghrun "$image" gh api 'sh /install.sh && ~/.local/bin/bridgehook --version')
	expect "newest stable CLI release, skipping a prerelease and other releases" "$out" \
		"grep -q 'Installing bridgehook $VERSION ' <<<\"\$out\" && grep -q '^bridgehook [0-9]' <<<\"\$out\""
	out=$(ghrun "$image" gh api-min 'sh /install.sh')
	expect "same from minified API JSON" "$out" "grep -q 'Installing bridgehook $VERSION ' <<<\"\$out\""
	out=$(ghrun "$image" gh api-limited 'sh /install.sh')
	expect "rate-limited API falls back to the latest-release redirect" "$out" \
		"grep -q 'Installing bridgehook $VERSION ' <<<\"\$out\" && grep -q 'Installed bridgehook' <<<\"\$out\""
	out=$(ghrun "$image" gh-other api-limited 'sh /install.sh; echo "exit=$?"')
	expect "no CLI release found: names BRIDGEHOOK_VERSION, installs nothing" "$out" \
		'grep -q "BRIDGEHOOK_VERSION" <<<"$out" && grep -q "exit=1" <<<"$out"'
done

# install.ps1 in the PowerShell container. Its non-Windows branch needs
# BRIDGEHOOK_INSTALL_DIR and skips the registry PATH and running the .exe.
PS1="$ROOT/apps/web/public/install.ps1"
WIN_SUM=$(awk '$2 == "bridgehook-x86_64-pc-windows-gnu.exe" { print $1 }' "$DIST/SHA256SUMS")
psrun() {
	docker run --rm --network "$NET" -v "$PS1:/install.ps1:ro" \
		-e BRIDGEHOOK_DOWNLOAD_URL="http://$MIRROR/$1" -e BRIDGEHOOK_VERSION=test \
		-e BRIDGEHOOK_INSTALL_DIR=/tmp/bh \
		--entrypoint pwsh mcr.microsoft.com/powershell:latest -NoProfile -Command "$2" 2>&1 || true
}
IEX='Get-Content -Raw /install.ps1 | Invoke-Expression'
echo "== install.ps1 (mcr.microsoft.com/powershell)"
out=$(psrun good "$IEX; (Get-FileHash /tmp/bh/bridgehook.exe -Algorithm SHA256).Hash.ToLower()")
expect "installs bridgehook.exe with the released hash" "$out" "grep -q 'Installed bridgehook' <<<\"\$out\" && grep -qx '$WIN_SUM' <<<\"\$out\""

out=$(psrun good "$IEX | Out-Null; $IEX; Get-ChildItem -Name /tmp/bh")
expect "re-running upgrades in place, no .new or .old left" "$out" \
	'[ "$(grep -c "Installed bridgehook" <<<"$out")" = 2 ] && grep -qx "bridgehook.exe" <<<"$out" && ! grep -q "bridgehook.exe.new\|bridgehook.exe.old" <<<"$out"'

out=$(psrun tampered "try { $IEX } catch { \"caught: \$_\" }; Test-Path /tmp/bh/bridgehook.exe")
expect "tampered binary aborts, nothing installed" "$out" 'grep -q "checksum mismatch" <<<"$out" && tail -n 1 <<<"$out" | grep -qx False'

out=$(psrun unlisted "try { $IEX } catch { \"caught: \$_\" }; Test-Path /tmp/bh/bridgehook.exe")
expect "binary missing from SHA256SUMS aborts" "$out" 'grep -q "not listed in SHA256SUMS" <<<"$out" && tail -n 1 <<<"$out" | grep -qx False'

psgh() {
	docker run --rm --network "$NET" -v "$PS1:/install.ps1:ro" \
		-e BRIDGEHOOK_GITHUB_URL="http://$MIRROR/$1" -e BRIDGEHOOK_GITHUB_API_URL="http://$MIRROR/$2" \
		-e BRIDGEHOOK_INSTALL_DIR=/tmp/bh \
		--entrypoint pwsh mcr.microsoft.com/powershell:latest -NoProfile -Command "$3" 2>&1 || true
}
out=$(psgh gh api "$IEX")
expect "newest stable CLI release, skipping a prerelease and other releases" "$out" "grep -q 'Installing bridgehook $VERSION ' <<<\"\$out\" && grep -q 'Installed bridgehook' <<<\"\$out\""
out=$(psgh gh api-limited "$IEX")
expect "rate-limited API falls back to the latest-release redirect" "$out" "grep -q 'Installing bridgehook $VERSION ' <<<\"\$out\" && grep -q 'Installed bridgehook' <<<\"\$out\""
out=$(psgh gh-other api-limited "try { $IEX } catch { \"caught: \$_\" }; Test-Path /tmp/bh/bridgehook.exe")
expect "no CLI release found: names BRIDGEHOOK_VERSION, installs nothing" "$out" 'grep -q "BRIDGEHOOK_VERSION" <<<"$out" && tail -n 1 <<<"$out" | grep -qx False'

out=$(docker run --rm --network none -v "$PS1:/install.ps1:ro" --entrypoint pwsh mcr.microsoft.com/powershell:latest \
	-NoProfile -Command "try { $IEX } catch { \"caught: \$_\" }" 2>&1 || true)
expect "points macOS and Linux users to install.sh" "$out" 'grep -q "install.sh" <<<"$out"'

echo
echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
