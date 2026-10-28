#Requires -Version 5.1
# Shared body for the read-only `Inspect-Coop-*` probes.
#
# Four scripts each did the same five things and had drifted while doing it:
# check the pinned compose file and a module, append one statement to that
# module's text, base64 it, and run it inside the live server with
# `docker compose exec -T server node -e`. The details that matter are subtle
# and were only reasoned about in one of them:
#   - `node -e` never executes `require.main === module`, so the inspector is
#     invoked explicitly instead of relying on the module's CLI block;
#   - base64 avoids every Windows quoting problem on the way into the container;
#   - `-T` stops Docker from allocating a TTY and mangling the JSON.
# They now live here once. Each wrapper still owns its parameters, validation,
# messages and banners: those are operator-facing text and are quoted in docs.

Set-StrictMode -Version Latest

# The expression that loads base64 from argv without any PowerShell/docker
# quoting round-trip. Byte-identical to what every probe used before.
$script:CoopProbeRunner = 'eval(Buffer.from(process.argv[1],String.fromCharCode(98,97,115,101,54,52)).toString())'

function Invoke-CoopContainerProbe {
  <#
  .SYNOPSIS
    Runs one read-only inspector inside the `server` container of a pinned
    EveJS compose file and reports the container's exit code as a throw.
  #>
  [CmdletBinding()]
  param(
    # Pinned checkout that owns compose.yaml (never the agents stack by default).
    [Parameter(Mandatory)][string]$CodePath,
    # Compose file to use; the caller decides which stack it points at.
    [string]$ComposeFile = 'compose.yaml',
    [string]$ComposeMissing = 'Missing upstream compose.yaml',
    # Module in this repository whose text becomes the script inside the container.
    [Parameter(Mandatory)][string]$ModulePath,
    [Parameter(Mandatory)][string]$ModuleMissing,
    # Statement appended to the module text; it must call the module's own
    # read-only entry point, because node -e skips require.main.
    [Parameter(Mandatory)][string]$Init,
    # Line terminator between the module text and $Init. Kept as a parameter so
    # a probe can preserve the exact bytes it has always sent.
    [string]$Separator = [Environment]::NewLine,
    # Extra container arguments; the inspector reads them from process.argv.
    [string[]]$Arguments = @(),
    # Printed before the probe so the operator knows what is being read.
    [string[]]$Before = @(),
    # Printed only after a successful read.
    [string[]]$After = @(),
    # Thrown text on a non-zero container exit; {code} is the Docker exit code.
    [string]$FailMessage = 'Container probe failed: Docker exit {code}',
    # A probe may need its own docker subcommand shape (e.g. an overlay file).
    [string[]]$ComposeArguments = @()
  )

  $compose = Join-Path $CodePath $ComposeFile
  if (!(Test-Path -LiteralPath $compose -PathType Leaf)) { throw $ComposeMissing }
  if (!(Test-Path -LiteralPath $ModulePath -PathType Leaf)) { throw $ModuleMissing }

  $body = [IO.File]::ReadAllText($ModulePath, [Text.Encoding]::UTF8)
  $body += $Separator + $Init
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($body))

  foreach ($line in $Before) { if ($line) { Write-Host $line } }
  & docker compose -f $compose @ComposeArguments exec -T server node -e $script:CoopProbeRunner $encoded @Arguments
  $code = $LASTEXITCODE
  if ($code -ne 0) { throw $FailMessage.Replace('{code}', "$code") }
  foreach ($line in $After) { if ($line) { Write-Host $line } }
}
