#!/bin/sh
# Install the BridgeHook CLI (macOS, Linux).
#
#   curl -fsSL https://bridgehook.dev/install.sh | sh
#
# Downloads the `bridgehook` binary for this OS and CPU from the latest
# CLI release on GitHub (tags `cli-v<version>`), checks it against the
# release's SHA256SUMS, and installs it to ~/.local/bin. Running it again
# upgrades in place. Nothing is installed unless the checksum matches.
#
#   BRIDGEHOOK_VERSION=0.1.0       a specific version instead of the latest
#   BRIDGEHOOK_INSTALL_DIR=/path   where to install (default ~/.local/bin)
#   BRIDGEHOOK_DOWNLOAD_URL=url    a directory holding the binaries and
#                                  SHA256SUMS (mirrors, tests)
#
# Windows: irm https://bridgehook.dev/install.ps1 | iex

set -eu

REPO="hallelx2/bridgehook"

say() { printf '%s\n' "$*"; }
err() {
	printf 'bridgehook install: %s\n' "$*" >&2
	exit 1
}

# Everything runs inside main, so a download cut short mid-script (curl | sh)
# runs nothing.
main() {
	need uname
	need mktemp
	need chmod
	need mkdir
	need mv

	target=$(detect_target)
	install_dir=${BRIDGEHOOK_INSTALL_DIR:-$HOME/.local/bin}

	if [ -n "${BRIDGEHOOK_DOWNLOAD_URL:-}" ]; then
		base=${BRIDGEHOOK_DOWNLOAD_URL%/}
		version=${BRIDGEHOOK_VERSION:-unknown}
	else
		version=$(resolve_version)
		base="https://github.com/$REPO/releases/download/cli-v$version"
	fi

	asset="bridgehook-$target"
	tmp=$(mktemp -d 2>/dev/null || mktemp -d -t bridgehook)
	trap 'rm -rf "$tmp"' EXIT INT TERM

	say "Installing bridgehook ${version} for ${target}"
	download "$base/$asset" "$tmp/$asset"
	download "$base/SHA256SUMS" "$tmp/SHA256SUMS"
	verify "$tmp" "$asset"

	mkdir -p "$install_dir" || err "cannot create $install_dir"
	chmod 755 "$tmp/$asset"
	# Move within the install directory so the swap is a rename: an existing
	# bridgehook is replaced in one step, never left half written.
	staged="$install_dir/.bridgehook.new.$$"
	mv "$tmp/$asset" "$staged" 2>/dev/null || { cp "$tmp/$asset" "$staged" && chmod 755 "$staged"; } ||
		err "cannot write to $install_dir (set BRIDGEHOOK_INSTALL_DIR to a directory you own)"
	mv -f "$staged" "$install_dir/bridgehook" || {
		rm -f "$staged"
		err "cannot replace $install_dir/bridgehook"
	}

	installed=$("$install_dir/bridgehook" --version 2>/dev/null || true)
	say "Installed ${installed:-bridgehook} to $install_dir/bridgehook"

	case ":$PATH:" in
	*":$install_dir:"*) ;;
	*)
		say ""
		say "$install_dir is not on your PATH. Add it, then open a new terminal:"
		case ${SHELL:-} in
		*/fish) say "  fish_add_path $install_dir" ;;
		*) say "  echo 'export PATH=\"$install_dir:\$PATH\"' >> $(profile_file)" ;;
		esac
		;;
	esac
	say ""
	say "Next: bridgehook login, then bridgehook forward 3000"
}

need() {
	command -v "$1" >/dev/null 2>&1 || err "needs '$1', which is not installed"
}

detect_target() {
	os=$(uname -s)
	arch=$(uname -m)
	case $os in
	Linux) os_part=unknown-linux-musl ;;
	Darwin) os_part=apple-darwin ;;
	MINGW* | MSYS* | CYGWIN* | Windows_NT)
		err "on Windows, run in PowerShell: irm https://bridgehook.dev/install.ps1 | iex" ;;
	*) err "no build for $os yet; see https://github.com/$REPO/releases" ;;
	esac
	case $arch in
	x86_64 | amd64) arch_part=x86_64 ;;
	aarch64 | arm64) arch_part=aarch64 ;;
	*) err "no build for $os on $arch yet; see https://github.com/$REPO/releases" ;;
	esac
	# An Intel shell under Rosetta on Apple silicon: install the native build.
	if [ "$os" = Darwin ] && [ "$arch_part" = x86_64 ] &&
		[ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
		arch_part=aarch64
	fi
	printf '%s-%s' "$arch_part" "$os_part"
}

# The newest CLI release, or BRIDGEHOOK_VERSION. Releases of the CLI are
# tagged cli-v<version>; the repository has other releases too.
resolve_version() {
	if [ -n "${BRIDGEHOOK_VERSION:-}" ]; then
		printf '%s' "${BRIDGEHOOK_VERSION#v}"
		return
	fi
	json=$(fetch_text "https://api.github.com/repos/$REPO/releases?per_page=50") ||
		err "cannot reach GitHub to find the latest release (set BRIDGEHOOK_VERSION to skip this)"
	# The API lists newest first and leaves out drafts.
	v=$(printf '%s\n' "$json" | sed -n 's/.*"tag_name": *"cli-v\([0-9][0-9A-Za-z.+-]*\)".*/\1/p' | head -n 1)
	[ -n "$v" ] || err "no CLI release published yet; see https://github.com/$REPO/releases"
	printf '%s' "$v"
}

fetch_text() {
	if command -v curl >/dev/null 2>&1; then
		curl -fsSL --retry 3 "$1"
	elif command -v wget >/dev/null 2>&1; then
		wget -qO- "$1"
	else
		err "needs curl or wget"
	fi
}

download() {
	if command -v curl >/dev/null 2>&1; then
		curl -fsSL --retry 3 -o "$2" "$1" || err "download failed: $1"
	elif command -v wget >/dev/null 2>&1; then
		wget -qO "$2" "$1" || err "download failed: $1"
	else
		err "needs curl or wget"
	fi
}

verify() {
	dir=$1
	file=$2
	expected=$(awk -v f="$file" '$2 == f || $2 == "*" f { print $1; exit }' "$dir/SHA256SUMS")
	[ -n "$expected" ] || err "$file is not listed in SHA256SUMS; not installing"
	if command -v sha256sum >/dev/null 2>&1; then
		actual=$(sha256sum "$dir/$file" | awk '{ print $1 }')
	elif command -v shasum >/dev/null 2>&1; then
		actual=$(shasum -a 256 "$dir/$file" | awk '{ print $1 }')
	elif command -v openssl >/dev/null 2>&1; then
		actual=$(openssl dgst -sha256 "$dir/$file" | awk '{ print $NF }')
	else
		err "needs sha256sum, shasum or openssl to check the download"
	fi
	[ "$actual" = "$expected" ] || err "checksum mismatch for $file (expected $expected, got $actual); not installing"
}

profile_file() {
	case ${SHELL:-} in
	*/zsh) printf '%s' "$HOME/.zshrc" ;;
	*/bash) printf '%s' "$HOME/.bashrc" ;;
	*) printf '%s' "$HOME/.profile" ;;
	esac
}

main "$@"
