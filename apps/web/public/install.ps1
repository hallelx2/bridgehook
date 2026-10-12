# Install the BridgeHook CLI (Windows).
#
#   irm https://bridgehook.dev/install.ps1 | iex
#
# Downloads bridgehook.exe from the newest stable CLI release on GitHub
# (tags cli-v<version>), checks that the download is intact against the
# release's SHA256SUMS, installs it to %LOCALAPPDATA%\bridgehook\bin and adds
# that folder to your user PATH (no administrator rights). Running it again
# upgrades in place. Nothing is installed unless the checksum matches.
# Works in Windows PowerShell 5.1 and PowerShell 7.
#
#   $env:BRIDGEHOOK_VERSION = '0.1.0'       a specific version
#   $env:BRIDGEHOOK_INSTALL_DIR = 'C:\...'  where to install
#   $env:BRIDGEHOOK_DOWNLOAD_URL = 'https://...'  a directory holding the
#                                           binaries and SHA256SUMS (mirrors)
#
# macOS and Linux: curl -fsSL https://bridgehook.dev/install.sh | sh

& {
	$ErrorActionPreference = 'Stop'
	Set-StrictMode -Version 3.0

	$Repo = 'hallelx2/bridgehook'
	# Overridable only so tests can stand in for GitHub.
	$GitHub = if ($env:BRIDGEHOOK_GITHUB_URL) { $env:BRIDGEHOOK_GITHUB_URL.TrimEnd('/') } else { 'https://github.com' }
	$GitHubApi = if ($env:BRIDGEHOOK_GITHUB_API_URL) { $env:BRIDGEHOOK_GITHUB_API_URL.TrimEnd('/') } else { 'https://api.github.com' }

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

	# The newest stable CLI release. CLI releases are tagged cli-v<version>;
	# the repository has other releases too, and prereleases are never
	# picked. The API lists newest first and leaves out drafts.
	function Get-NewestCliVersion {
		try {
			$releases = Invoke-RestMethod -UseBasicParsing -Uri "$GitHubApi/repos/$Repo/releases?per_page=50" -Headers @{ 'User-Agent' = 'bridgehook-install' }
			# Windows PowerShell 5.1 passes a JSON array down the pipeline as
			# one object, so walk it explicitly.
			foreach ($release in @($releases)) {
				if ($release.tag_name -like 'cli-v[0-9]*' -and -not $release.prerelease) {
					return $release.tag_name.Substring(5)
				}
			}
		} catch {
			$null = $_ # fall through to the redirect below
		}
		# The API failed (60 requests an hour per IP; offices and CI hit it) or
		# listed no CLI release: GitHub's latest-release redirect is not limited
		# the same way. The publish script marks CLI releases latest.
		$tag = Get-LatestRedirectTag
		if ($tag -like 'cli-v[0-9]*') { return $tag.Substring(5) }
		Fail "cannot find the newest CLI release (GitHub's API may be rate-limiting this network). Set `$env:BRIDGEHOOK_VERSION = '0.1.0' (for example) and run again, or see https://github.com/$Repo/releases"
	}

	# The tag GitHub's /releases/latest redirects to, or $null.
	function Get-LatestRedirectTag {
		try {
			$request = [Net.HttpWebRequest]::Create("$GitHub/$Repo/releases/latest")
			$request.AllowAutoRedirect = $false
			$request.Method = 'HEAD'
			$request.UserAgent = 'bridgehook-install'
			$response = $request.GetResponse()
			try {
				$location = $response.Headers['Location']
			} finally {
				$response.Close()
			}
			if ($location -match '/tag/([A-Za-z0-9._+-]+)$') { return $Matches[1] }
		} catch {
			$null = $_
		}
		return $null
	}

	# Adds a folder to the user PATH (HKCU\Environment, no administrator
	# rights). The value is read and written raw, as REG_EXPAND_SZ, so entries
	# such as %USERPROFILE%\bin stay references instead of being frozen to
	# today's expansion; open programs are then told the environment changed.
	function Add-UserPath([string]$Dir) {
		$key = Get-Item -LiteralPath 'HKCU:\Environment'
		$raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
		$entries = @($raw -split ';' | Where-Object { $_ })
		$present = $entries | Where-Object { [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\') -ieq $Dir.TrimEnd('\') }
		if ($present) { return $false }
		Set-ItemProperty -LiteralPath 'HKCU:\Environment' -Name 'Path' -Type ExpandString -Value (($entries + $Dir) -join ';')
		Send-EnvironmentChanged
		return $true
	}

	# WM_SETTINGCHANGE "Environment", as setx and the System settings send.
	function Send-EnvironmentChanged {
		try {
			if (-not ('BridgeHookInstall.Native' -as [type])) {
				Add-Type -Namespace BridgeHookInstall -Name Native -MemberDefinition @'
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
'@
			}
			$result = [UIntPtr]::Zero
			[void][BridgeHookInstall.Native]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
		} catch {
			$null = $_ # new terminals still read the registry
		}
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
			$version = Get-NewestCliVersion
		}
		$base = "$GitHub/$Repo/releases/download/cli-v$version"
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
		if (Add-UserPath $installDir) {
			Say "Added $installDir to your user PATH; open a new terminal to use bridgehook."
		}
		if (-not (($env:Path -split ';') | Where-Object { $_.TrimEnd('\') -ieq $installDir.TrimEnd('\') })) {
			$env:Path = "$env:Path;$installDir"
		}
	}

	Say
	Say 'Next: bridgehook login, then bridgehook forward 3000'
}
