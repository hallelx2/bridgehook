# Lint apps/web/public/install.ps1 with PSScriptAnalyzer: warnings and
# errors, the PSGallery rule set, and syntax compatibility with Windows
# PowerShell 5.1 and PowerShell 7. Exits 1 on any finding.
#
#   docker run --rm -v "$PWD:/src:ro" mcr.microsoft.com/powershell:latest \
#     pwsh -NoProfile -File /src/scripts/lint-install-ps1.ps1
param([string]$Path = (Join-Path $PSScriptRoot '../apps/web/public/install.ps1'))

$ErrorActionPreference = 'Stop'
# Pinned: reproducible, and 1.23+ refuses PowerShell older than 7.4.6.
$analyzerVersion = '1.22.0'
if (-not (Get-Module -ListAvailable PSScriptAnalyzer | Where-Object { $_.Version -eq $analyzerVersion })) {
	Set-PSRepository PSGallery -InstallationPolicy Trusted
	Install-Module PSScriptAnalyzer -RequiredVersion $analyzerVersion -Scope CurrentUser -Force
}
Import-Module PSScriptAnalyzer -RequiredVersion $analyzerVersion

$findings = @()
$findings += Invoke-ScriptAnalyzer -Path $Path -Severity Warning, Error
$findings += Invoke-ScriptAnalyzer -Path $Path -Settings PSGallery -Severity Warning, Error
$findings += Invoke-ScriptAnalyzer -Path $Path -IncludeRule PSUseCompatibleSyntax -Settings @{
	Rules = @{ PSUseCompatibleSyntax = @{ Enable = $true; TargetVersions = @('5.1', '7.0') } }
}
$findings = $findings | Sort-Object Line, RuleName -Unique

if ($findings) {
	$findings | Format-Table RuleName, Severity, Line, Message -AutoSize -Wrap | Out-String -Width 220 | Write-Host
	Write-Host "$(@($findings).Count) finding(s) in $Path"
	exit 1
}
Write-Host "PSScriptAnalyzer: no findings in $Path (warnings, errors, PSGallery, 5.1/7 syntax)"
