# Shared body of the source-only gate runners (scripts/Run-*.ps1).
#
# Why this file exists: nineteen gate scripts repeated the same six steps in
# slightly different order - resolve the repo, create a report dir, resolve
# node, check that the declared test files exist, refuse a scenario manifest
# that claims PASS without evidence, run `node --test` into a log, print the
# tail and throw on a non-zero exit. The messages drifted between copies
# (`Missing test` vs `Missing required test:` vs `ALIFE12_REQUIRED_TEST_MISSING`)
# and a fix to one step never reached the other eighteen.
#
# The runner never starts Docker, never touches evejs-data and never decides
# that gameplay passed: it throws the same messages as before so an operator
# and the docs keep working, and every wrapper still owns its own data.
#
# Usage (from a wrapper in scripts/):
#   . (Join-Path $PSScriptRoot "lib/CoopGate.ps1")
#   Invoke-CoopNodeGate @{ Name="LW04B"; ReportSlug="evejs-lw04b-gates"; Tests=$tests
#     Manifest=@{...}; Banner=@("...") } -ReportDir $ReportDir

# Resolved once, when this file is dot-sourced: $PSScriptRoot is scripts/lib here.
$script:CoopGateRepo = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path

# The gate rows themselves are data (scripts/lib/gates.json) so a new gate is a
# few lines, and tests/coop-gate-specs.test.mjs can prove that every declared
# test, manifest and pin file still exists instead of discovering it at run time.
function Get-CoopGateSpec {
  param([Parameter(Mandatory)][string]$Id)
  $file = Join-Path $PSScriptRoot "gates.json"
  $specs = Get-Content -Raw -Path $file | ConvertFrom-Json
  $spec = $specs.gates.$Id
  if (-not $spec) { throw "GATE_SPEC_UNKNOWN: $Id (see scripts/lib/gates.json)" }
  return $spec
}

function Invoke-CoopGateById {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Id,
    [string]$ReportDir = "",
    # Gates that declare pinned verifiers expose -UpstreamCodeRoot; the others ignore it.
    [string]$UpstreamCodeRoot = ""
  )
  $spec = Get-CoopGateSpec -Id $Id
  $tests = @($spec.tests)
  foreach ($optional in @($spec.optionalTests)) {
    if ($optional -and (Test-Path (Join-Path $script:CoopGateRepo ([string]$optional.exists)))) {
      $tests += [string]$optional.test
    }
  }
  $gate = @{
    Name = [string]$spec.name
    ReportSlug = [string]$spec.reportSlug
    Tests = $tests
    LogName = [string]$spec.logName
    Tail = [int]$spec.tail
    TestMissing = [string]$spec.testMissing
    NodeFail = [string]$spec.nodeFail
    Banner = @($spec.banner)
    Syntax = @($spec.syntax)
    SyntaxFail = [string]$spec.syntaxFail
  }
  if ($spec.manifest) {
    $gate.Manifest = @{
      Path = [string]$spec.manifest.path
      Missing = [string]$spec.manifest.missing
      Schema = [string]$spec.manifest.schema
      Count = $spec.manifest.count
      Op = [string]$spec.manifest.op
      Invalid = [string]$spec.manifest.invalid
    }
  }
  if ($spec.pinned) {
    $verifiers = @()
    foreach ($verifier in @($spec.pinned.scripts)) {
      $verifiers += @{ Path = [string]$verifier.path; Fail = [string]$verifier.fail }
    }
    $gate.Pinned = @{
      UpstreamCodeRoot = $UpstreamCodeRoot
      Scripts = $verifiers
      Fail = if ($verifiers.Count) { [string]$verifiers[0].Fail } else { "" }
      Missing = [string]$spec.pinned.missing
      MissingKind = [string]$spec.pinned.missingKind
    }
  }
  Invoke-CoopNodeGate -Gate $gate -ReportDir $ReportDir
}

function Invoke-CoopNodeGate {
  [CmdletBinding()]
  param(
    # One hashtable keeps a wrapper readable as data: Name, ReportSlug, Tests,
    # LogName, Tail, TestMissing, Manifest, Syntax, Pinned, NodeFail, Banner.
    [Parameter(Mandatory)][hashtable]$Gate,
    [string]$ReportDir = ""
  )
  $ErrorActionPreference = "Stop"
  $repo = $script:CoopGateRepo
  $name = [string]$Gate.Name
  if ([string]::IsNullOrWhiteSpace($name)) { throw "GATE_SPEC_INVALID: Gate.Name is required" }
  $tests = @($Gate.Tests)
  if ($tests.Count -eq 0) { throw "GATE_SPEC_INVALID: $name declares no test files" }

  if ([string]::IsNullOrWhiteSpace($ReportDir)) {
    $ReportDir = Join-Path ([System.IO.Path]::GetTempPath) ([string]$Gate.ReportSlug)
  }
  New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
  $node = (Get-Command node -ErrorAction Stop).Source

  # 1. Every declared file must exist before anything runs: a silently missing
  # test file used to read as a green suite.
  $testMissing = if ($Gate.TestMissing) { [string]$Gate.TestMissing } else { "$name required test missing: {test}" }
  foreach ($test in $tests) {
    if (-not (Test-Path (Join-Path $repo $test))) {
      throw ($testMissing.Replace("{test}", $test))
    }
  }

  # 2. Optional `node --check` of the overlay copies a gate claims to protect.
  foreach ($file in @($Gate.Syntax)) {
    if (-not $file) { continue }
    & $node --check (Join-Path $repo $file)
    if ($LASTEXITCODE -ne 0) {
      $syntaxFail = if ($Gate.SyntaxFail) { [string]$Gate.SyntaxFail } else { "$name source syntax check failed: {file}" }
      throw ($syntaxFail.Replace("{file}", $file))
    }
  }

  # 3. A physical/manual scenario manifest may only ever be NOT_RUN here.
  $scenarioCount = 0
  $manifest = $Gate.Manifest
  if ($manifest) {
    $manifestPath = Join-Path $repo ([string]$manifest.Path)
    if (-not (Test-Path $manifestPath)) {
      throw (if ($manifest.Missing) { [string]$manifest.Missing } else { "$name scenario manifest missing: $($manifest.Path)" })
    }
    $loaded = Get-Content -Raw -Path $manifestPath | ConvertFrom-Json
    $scenarios = @($loaded.scenarios)
    $invalid = $loaded.schema -ne [string]$manifest.Schema
    if (-not $invalid -and $manifest.Count) {
      $op = if ($manifest.Op) { [string]$manifest.Op } else { "eq" }
      switch ($op) {
        "eq" { $invalid = $scenarios.Count -ne [int]$manifest.Count }
        "ge" { $invalid = $scenarios.Count -lt [int]$manifest.Count }
        default { throw "GATE_SPEC_INVALID: $name unknown manifest count op '$op'" }
      }
    }
    if (-not $invalid) {
      $invalid = @($scenarios | Where-Object { $_.status -ne "NOT_RUN" }).Count -gt 0
    }
    if ($invalid) { throw ([string]$manifest.Invalid) }
    $scenarioCount = $scenarios.Count
  }

  # 4. The suite itself, into a log the operator can open.
  $log = Join-Path $ReportDir $(if ($Gate.LogName) { [string]$Gate.LogName } else { "$($name.ToLower())-node.log" })
  Push-Location $repo
  try {
    & $node --test @tests *> $log
    $exitCode = $LASTEXITCODE
  } finally { Pop-Location }
  $tail = if ($Gate.Tail) { [int]$Gate.Tail } else { 45 }
  Get-Content -Path $log | Select-Object -Last $tail | ForEach-Object { Write-Host $_ }
  if ($exitCode -ne 0) {
    $nodeFail = if ($Gate.NodeFail) { [string]$Gate.NodeFail } else { "$name Node tests FAILED: {log}" }
    throw ($nodeFail.Replace("{log}", $log).Replace("{code}", "$exitCode"))
  }

  # 5. Optional read-only comparison against the pinned original checkout.
  $pinned = $Gate.Pinned
  if ($pinned) {
    $upstream = [string]$pinned.UpstreamCodeRoot
    if ([string]::IsNullOrWhiteSpace($upstream)) {
      $note = [string]$pinned.Missing
      if ($note) {
        if ($pinned.MissingKind -eq "Warning") { Write-Warning $note } else { Write-Host $note }
      }
    } else {
      foreach ($verifier in @($pinned.Scripts)) {
        $verifierScript = if ($verifier -is [hashtable]) { [string]$verifier.Path } else { [string]$verifier }
        & $node (Join-Path $repo $verifierScript) $upstream
        if ($LASTEXITCODE -ne 0) {
          $fail = if ($verifier -is [hashtable] -and $verifier.Fail) { [string]$verifier.Fail } else { [string]$pinned.Fail }
          throw $fail
        }
      }
    }
  }

  foreach ($line in @($Gate.Banner)) {
    if ($line) { Write-Host ([string]$line).Replace("{scenarios}", "$scenarioCount") }
  }
}
