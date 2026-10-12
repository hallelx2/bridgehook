# Install the BridgeHook CLI (Windows).
#
#   irm https://bridgehook.dev/install.ps1 | iex
#
# Downloads bridgehook.exe from the latest CLI release on GitHub (tags
# cli-v<version>), checks it against the release's SHA256SUMS, installs it
# to %LOCALAPPDATA%\bridgehook\bin and adds that folder to your user PATH
# (no administrator rights). Running it again upgrades in place. Nothing is
# installed unless the checksum matches. Works in Windows PowerShell 5.1
# and PowerShell 7.
#
#   $env:BRIDGEHOOK_VERSION = '0.1.0'       a specific version
#   $env:BRIDGEHOOK_INSTALL_DIR = 'C:\...'  where to install
#   $env:BRIDGEHOOK_DOWNLOAD_URL = 'https://...'  a directory holding the
#                                           binaries and SHA256SUMS (mirrors, tests)
#
# macOS and Linux: curl -fsSL https://bridgehook.dev/install.sh | sh

& {
	$ErrorActionPreference = 'Stop'
	Set-StrictMode -Version 3.0

	$Repo = 'hallelx2/bridgehook'

	# Messages for the person watching: Write-Output would land in the
	# pipeline of `irm | iex`, and Write-Information is hidden by default.
	function Say {
		[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingWriteHost', '')]
		param([string]$Message = '')
		Write-Host $Message
	}

	function Fail([string]$Message) {
		throw "bridgehook install: $Message"
	}

	# Windows PowerShell 5.1 may default to TLS 1.0, which GitHub refuses.
	if ($PSVersionTable.PSVersion.Major -lt 6) {
		[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
	}

	$onWindows = ($PSVersionTable.PSVersion.Major -lt 6) -or $IsWindows

	# One build for now: x64, which Windows on ARM runs under emulation.
	$target = 'x86_64-pc-windows-gnu'
	if ($env:BRIDGEHOOK_TARGET) { $target = $env:BRIDGEHOOK_TARGET }
	$asset = "bridgehook-$target.exe"

	if ($env:BRIDGEHOOK_INSTALL_DIR) {
		$installDir = $env:BRIDGEHOOK_INSTALL_DIR
	} elseif ($onWindows) {
		$installDir = Join-Path $env:LOCALAPPDATA 'bridgehook\bin'
	} else {
		Fail 'this script is for Windows; on macOS and Linux run: curl -fsSL https://bridgehook.dev/install.sh | sh'
	}

	if ($env:BRIDGEHOOK_DOWNLOAD_URL) {
		$base = $env:BRIDGEHOOK_DOWNLOAD_URL.TrimEnd('/')
		$version = if ($env:BRIDGEHOOK_VERSION) { $env:BRIDGEHOOK_VERSION } else { 'unknown' }
	} else {
		if ($env:BRIDGEHOOK_VERSION) {
			$version = $env:BRIDGEHOOK_VERSION.TrimStart('v')
		} else {
			# Newest first, drafts left out; the repository has other releases too.
			try {
				$releases = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$Repo/releases?per_page=50" -Headers @{ 'User-Agent' = 'bridgehook-install' }
			} catch {
				Fail "cannot reach GitHub to find the latest release (set `$env:BRIDGEHOOK_VERSION to skip this): $($_.Exception.Message)"
			}
			$tag = $releases | Where-Object { $_.tag_name -like 'cli-v*' } | Select-Object -First 1 -ExpandProperty tag_name
			if (-not $tag) { Fail "no CLI release published yet; see https://github.com/$Repo/releases" }
			$version = $tag.Substring(5)
		}
		$base = "https://github.com/$Repo/releases/download/cli-v$version"
	}

	Say "Installing bridgehook $version for $target"

	$tmp = Join-Path ([IO.Path]::GetTempPath()) ("bridgehook-" + [Guid]::NewGuid().ToString('N'))
	New-Item -ItemType Directory -Path $tmp | Out-Null
	try {
		$exe = Join-Path $tmp $asset
		$sums = Join-Path $tmp 'SHA256SUMS'
		# The progress bar makes Invoke-WebRequest many times slower in 5.1.
		$oldProgress = $ProgressPreference
		$ProgressPreference = 'SilentlyContinue'
		try {
			Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile $exe
			Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile $sums
		} catch {
			Fail "download failed from ${base}: $($_.Exception.Message)"
		} finally {
			$ProgressPreference = $oldProgress
		}

		$expected = $null
		foreach ($line in Get-Content -LiteralPath $sums) {
			$parts = $line -split '\s+', 2
			if ($parts.Count -eq 2 -and ($parts[1] -eq $asset -or $parts[1] -eq "*$asset")) {
				$expected = $parts[0].ToLowerInvariant()
				break
			}
		}
		if (-not $expected) { Fail "$asset is not listed in SHA256SUMS; not installing" }
		$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $exe).Hash.ToLowerInvariant()
		if ($actual -ne $expected) {
			Fail "checksum mismatch for $asset (expected $expected, got $actual); not installing"
		}

		New-Item -ItemType Directory -Force -Path $installDir | Out-Null
		$dest = Join-Path $installDir 'bridgehook.exe'
		$staged = Join-Path $installDir 'bridgehook.exe.new'
		Copy-Item -LiteralPath $exe -Destination $staged -Force
		if (Test-Path -LiteralPath $dest) {
			# A running bridgehook.exe cannot be overwritten, but it can be
			# renamed; the old copy is removed on the next install.
			$old = Join-Path $installDir 'bridgehook.exe.old'
			Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue
			Move-Item -LiteralPath $dest -Destination $old -Force
		}
		Move-Item -LiteralPath $staged -Destination $dest -Force
		Remove-Item -LiteralPath (Join-Path $installDir 'bridgehook.exe.old') -Force -ErrorAction SilentlyContinue
	} finally {
		Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
	}

	$installed = $null
	if ($onWindows) {
		try { $installed = & $dest --version } catch { $installed = $null }
	}
	if ($installed) {
		Say "Installed $installed to $dest"
	} else {
		Say "Installed bridgehook to $dest"
	}

	# A custom install directory is left off PATH unless asked for.
	$addToPath = $onWindows -and ((-not $env:BRIDGEHOOK_INSTALL_DIR) -or $env:BRIDGEHOOK_ADD_TO_PATH)
	if ($addToPath) {
		# The user PATH lives in the registry (HKCU\Environment); this API
		# writes it and tells open programs, with no administrator rights.
		$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
		$entries = @()
		if ($userPath) { $entries = $userPath -split ';' | Where-Object { $_ } }
		if (-not ($entries | Where-Object { $_.TrimEnd('\') -ieq $installDir.TrimEnd('\') })) {
			[Environment]::SetEnvironmentVariable('Path', (($entries + $installDir) -join ';'), 'User')
			Say "Added $installDir to your user PATH; open a new terminal to use bridgehook."
		}
		if (-not (($env:Path -split ';') | Where-Object { $_.TrimEnd('\') -ieq $installDir.TrimEnd('\') })) {
			$env:Path = "$env:Path;$installDir"
		}
	}

	Say
	Say 'Next: bridgehook login, then bridgehook forward 3000'
}
