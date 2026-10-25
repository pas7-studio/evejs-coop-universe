#Requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('Prepare','Start','CoopStart','LaunchOne','LaunchTwo','Status','Smoke','Party','World','DiagnoseWorld','Combat','StockRaid','StockRaidLoot','LootPickup','FinalBlow','Market','Logs','Stop','Publish')]
    [string]$Action = 'Status',
    [string]$CodePath = 'C:\Games\EveCoop\upstream-evejs\Code',
    [string]$OutputRoot = '',
    [int]$LaunchGapSeconds = 20,
    [int]$HealthTimeoutSeconds = 240,
    [int]$NpcSystemID = 30000142,
    # Dedicated physical-mining World gate: Jita legitimately has zero belts.
    [int]$WorldSystemID = 30000144,
    [string]$Note = '',
    [string]$Next = '',
    [switch]$ConfirmClientPermission
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputRoot) { $OutputRoot = Join-Path $projectRoot 'test-results' }
$compose = Join-Path $CodePath 'compose.yaml'
$play = Join-Path $CodePath 'Play.bat'
if ($LaunchGapSeconds -lt 0 -or $LaunchGapSeconds -gt 300) { throw 'LaunchGapSeconds must be 0..300' }
if ($HealthTimeoutSeconds -lt 15 -or $HealthTimeoutSeconds -gt 900) { throw 'HealthTimeoutSeconds must be 15..900' }
function Get-ComposeArgs {
    $options=@('--project-directory',$CodePath,'-f',$compose)
    $overlay=Join-Path $CodePath 'compose.coop-probe.yaml'
    if(Test-Path -LiteralPath $overlay -PathType Leaf){$options+=@('-f',$overlay)}
    return ,$options
}
function Invoke-Compose([string[]]$Arguments) {
    $options=Get-ComposeArgs
    & docker compose @options @Arguments
    if ($LASTEXITCODE -ne 0) { throw "docker compose failed: $($Arguments -join ' ')" }
}
function Assert-BackendPrerequisites {
    if (-not (Test-Path -LiteralPath $compose -PathType Leaf)) { throw "Missing upstream compose.yaml: $compose. Run scripts/Fetch-Upstream.ps1 first." }
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker Desktop CLI unavailable.' }
    $os = (& docker info --format '{{.OSType}}' 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $os -ne 'linux') { throw "Docker must be running Linux containers: $os" }
}
function Wait-BackendHealthy {
    $deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
    do {
        # Run the health checker in a separate process: its 'exit 1' must
        # not terminate this orchestrator before the retry loop finishes.
        $pwsh = (Get-Process -Id $PID).Path
        & $pwsh -NoProfile -NonInteractive -File (Join-Path $PSScriptRoot 'Check-Backend.ps1') -CodePath $CodePath
        if ($LASTEXITCODE -eq 0) { return }
        Write-Host 'Backend still initializing; retrying health check...'
        Start-Sleep -Seconds 10
    } while ((Get-Date) -lt $deadline)
    throw "Backend did not become healthy within $HealthTimeoutSeconds seconds. Run -Action Logs for diagnostics."
}
function Get-Timestamp { Get-Date -Format 'yyyyMMdd-HHmmss' }
# Cloud sessions cannot see this machine, so every launch writes a small,
# redacted snapshot into state/ (tests, overlay, server events, client tail).
function Publish-StateSnapshot([string]$StateNote,[string]$StateNext,[switch]$IncludeTests) {
    $publisher = Join-Path $PSScriptRoot 'Publish-SessionState.ps1'
    if (-not (Test-Path -LiteralPath $publisher -PathType Leaf)) { return }
    try {
        $arguments = @{ CodePath = $CodePath; Note = $StateNote; Next = $StateNext }
        if (-not $IncludeTests) { $arguments['SkipTests'] = $true }
        & $publisher @arguments
    } catch {
        Write-Warning "[STATE] Session state publish failed: $($_.Exception.Message)"
    }
}
switch ($Action) {
    'Prepare' {
        Assert-BackendPrerequisites
        & (Join-Path $PSScriptRoot 'Test-ComposeSafety.ps1') -CodePath $CodePath
        if ($LASTEXITCODE -ne 0) { throw 'Compose safety check failed.' }
        Invoke-Compose @('build','init')
        Invoke-Compose @('run','--rm','--no-deps','market-tools','engines')
        Invoke-Compose @('run','--rm','--no-deps','market-tools','rebuild','v1','--preset','jita_new_caldari')
        Write-Host 'Prepare complete. Next: -Action Start'
    }
    'Start' {
        Assert-BackendPrerequisites
        & (Join-Path $PSScriptRoot 'Test-ComposeSafety.ps1') -CodePath $CodePath
        if ($LASTEXITCODE -ne 0) { throw 'Compose safety check failed.' }
        Invoke-Compose @('up','--detach')
        Wait-BackendHealthy
        Write-Host 'Server running. Next: -Action LaunchTwo'
        Publish-StateSnapshot -StateNote 'server started (plain Start)' -StateNext 'launch one authorized client, then two'
    }
    'CoopStart' {
        Assert-BackendPrerequisites
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22+ required for pinned overlay.' }
        if ($NpcSystemID -le 0) { throw 'NpcSystemID must be a positive EveJS system ID.' }
        & (Join-Path $PSScriptRoot 'Test-ComposeSafety.ps1') -CodePath $CodePath
        if ($LASTEXITCODE -ne 0) { throw 'Unsafe Compose configuration.' }
        # Real, persistent NPC society. No arena waves, encounter timer,
        # fake kill targets, world reset or market rebuild.
        $alternateSystem=if($NpcSystemID -eq 30000144){30000142}else{30000144}
        $virtualRoute="$NpcSystemID,$alternateSystem"
        & (Join-Path $PSScriptRoot 'Deploy-Coop-RuntimeProbe.ps1') -CodePath $CodePath -LivingCoop -VirtualRouteSystems $virtualRoute -VirtualPopulation 20 -MaterializeLimit 6 -CloneRecoveryMinutes 30
        if (-not $?) { throw 'Living Universe deployment failed.' }
        Wait-BackendHealthy
        Write-Host ("[COOP] Living Universe running. 20 named persistent pilots across route $virtualRoute; up to 6 materialized NPCs per visited system.")
        Write-Host '[COOP] NPC pirates, civilians and faction patrols follow autonomous activity; engage their real ships in space.'
        Write-Host '[COOP] No waves or player-triggered combat arenas. NPC ship losses persist with a recovery delay.'
        Write-Host '[COOP] First inspect headless NPC with DiagnoseWorld and World; Party is for two authenticated players.'
        Write-Warning 'Friend-PC/VPN access is NOT enabled by this command. Upstream still binds localhost.'
        Publish-StateSnapshot -StateNote "LivingCoop deployed (route $virtualRoute)" -StateNext 'run -Action World -WorldSystemID 30000144'
    }
    'LaunchOne' {
        Assert-BackendPrerequisites
        if (-not $ConfirmClientPermission) { throw 'Pass -ConfirmClientPermission only for an authorized compatible client.' }
        if (-not (Test-Path -LiteralPath $play -PathType Leaf)) { throw "Missing Play.bat: $play" }
        Start-Process -FilePath 'cmd.exe' -ArgumentList '/k call Play.bat' -WorkingDirectory $CodePath | Out-Null
        Write-Host '[PLAY] Started one local game client. Use the same authoritative Docker server for the second pilot.'
        Write-Warning 'For a second PC use only a separately authorized client and a verified private tunnel; no public ports.'
        Publish-StateSnapshot -StateNote 'one client launcher started' -StateNext 'log in, then capture the client log tail via -Action Publish'
    }
    'LaunchTwo' {
        Assert-BackendPrerequisites
        if (-not $ConfirmClientPermission) { throw 'Explicitly pass -ConfirmClientPermission after confirming lawful client access, setup and permissions.' }
        if (-not (Test-Path -LiteralPath $play -PathType Leaf)) { throw "Missing Play.bat: $play" }
        & (Join-Path $PSScriptRoot 'Check-Backend.ps1') -CodePath $CodePath
        if ($LASTEXITCODE -ne 0) { throw 'Backend is not healthy. Not launching clients.' }
        Write-Warning 'EveJS Play.bat was designed for single-client setup; multi-instance compatibility and shared cache isolation have NOT been verified. This command starts two launchers, not two guaranteed working game clients.'
        New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
        for ($n = 1; $n -le 2; $n++) {
            # Start each upstream launcher in its own visible command window.
            # Never copy/patch proprietary client binaries, install CA trust, or alter client config here.
            # PowerShell sets WorkingDirectory, so avoid nested cd /d quoting.
            Start-Process -FilePath 'cmd.exe' -ArgumentList '/k call Play.bat' -WorkingDirectory $CodePath | Out-Null
            Write-Host "Started Play.bat launcher #$n. Sign in with separate test account $n."
            if ($n -eq 1 -and $LaunchGapSeconds -gt 0) { Start-Sleep -Seconds $LaunchGapSeconds }
        }
        Write-Host 'Use separate test accounts/characters, never the same character in two sessions.'
        Publish-StateSnapshot -StateNote 'two client launchers started' -StateNext 'prove two authenticated characters in one world (-Action Party)'
    }
    'Status' {
        Assert-BackendPrerequisites
        Invoke-Compose @('ps','--all')
        & (Join-Path $PSScriptRoot 'Check-Backend.ps1') -CodePath $CodePath
        if ($LASTEXITCODE -ne 0) { throw 'Backend health check failed.' }
    }
    'Smoke' {
        Assert-BackendPrerequisites
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22+ is required for transport smoke.' }
        $probe = Join-Path $PSScriptRoot 'smoke-two-tcp.mjs'
        & node $probe
        if ($LASTEXITCODE -ne 0) { throw 'Two concurrent TCP connections to EveJS game port failed.' }
        Write-Host 'Transport only: this is NOT a two-player login or gameplay PASS.'
    }
    'Party' {
        Assert-BackendPrerequisites
        $report=Join-Path $PSScriptRoot 'coop-party-report.cjs'
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22+ is required for the party report.' }
        $options=Get-ComposeArgs
        $events=@(& docker compose @options exec -T server cat /var/lib/evejs/coop-events.jsonl 2>$null)
        if ($LASTEXITCODE -ne 0) {
            throw 'BLOCKED_TELEMETRY_OR_CLIENT: use DiagnoseWorld first, then check that both real characters reached space. Do not repeat deployment just for this failure.'
        }
        $events | & node $report
        if ($LASTEXITCODE -ne 0) { throw 'Could not generate co-op scene report.' }
    }
    'DiagnoseWorld' {
        Assert-BackendPrerequisites
        & (Join-Path $PSScriptRoot 'Diagnose-LivingWorld.ps1') -CodePath $CodePath
        if (-not $?) { throw 'Read-only Living Universe diagnostic failed.' }
    }
    'World' {
        Assert-BackendPrerequisites
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22+ is required for world report.' }
        $options=Get-ComposeArgs
        $events=@(& docker compose @options exec -T server cat /var/lib/evejs/coop-events.jsonl 2>$null)
        if ($LASTEXITCODE -ne 0) {
            throw 'BLOCKED_TELEMETRY: missing /var/lib/evejs/coop-events.jsonl. Run -Action DiagnoseWorld to inspect the running overlay, startup hook and log path WITHOUT restarting. Headless boot should emit a boot-requested event before any game client logs in; do not substitute npm audit or TCP tests.'
        }
        $events | & node (Join-Path $PSScriptRoot 'coop-world-report.cjs') --require-activity --system-id $WorldSystemID
        if ($LASTEXITCODE -ne 0) {
            throw 'Physical NPC activity is not yet confirmed. Inspect movement, ore and native target evidence in the report, then -Action Logs.'
        }
        Write-Host "[WORLD] Native mining+physical NPC evidence verified for $WorldSystemID. Client rendering, combat and loot remain unverified."
        Publish-StateSnapshot -StateNote "World gate PASS for system $WorldSystemID (server-native)" -StateNext 'one authorized client must visually confirm the same NPC'
    }
    'Combat' {
        Assert-BackendPrerequisites
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22+ is required for native combat evidence.' }
        $options=Get-ComposeArgs
        $events=@(& docker compose @options exec -T server cat /var/lib/evejs/coop-events.jsonl 2>$null)
        if ($LASTEXITCODE -ne 0) {
            throw 'No native NPC battle log. Start LivingCoop locally; do not infer combat from healthy Docker or TCP.'
        }
        $events | & node (Join-Path $PSScriptRoot 'coop-world-report.cjs') --require-combat --require-weapon
        if ($LASTEXITCODE -ne 0) {
            throw 'NPC battle gate not proven: require real NPC weapon activation or missile launch, linked HP loss, native physical wreck and stored loot. See report.'
        }
        Write-Host '[COMBAT] Correlated named-NPC HP reduction, physical wreck and saved loot observed on server. Shooter attribution and real EVE client gameplay remain unproven.'
    }
    'StockRaid' {
        Assert-BackendPrerequisites
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22+ is required for stock-fleet combat evidence.' }
        $options=Get-ComposeArgs
        $events=@(& docker compose @options exec -T server cat /var/lib/evejs/coop-events.jsonl 2>$null)
        if ($LASTEXITCODE -ne 0) { throw 'No server combat evidence. Run -Action DiagnoseWorld to find the native boot blocker.' }
        $events | & node (Join-Path $PSScriptRoot 'coop-world-report.cjs') --require-stock-raid --system-id $WorldSystemID
        if ($LASTEXITCODE -ne 0) {
            throw 'No correlated native weapon and measured stock miner HP loss yet. An attack order or a target lock is insufficient.'
        }
        Write-Host '[STOCK RAID] Native weapon activation and real stock miner/hauler HP drop correlated. Wreck, loot and two-client rendering are NOT proven.'
    }
    'StockRaidLoot' {
        Assert-BackendPrerequisites
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22+ is required for native stock PvE proof.' }
        $options=Get-ComposeArgs
        $events=@(& docker compose @options exec -T server cat /var/lib/evejs/coop-events.jsonl 2>$null)
        if ($LASTEXITCODE -ne 0) { throw 'No native combat telemetry. DiagnoseWorld is read-only and identifies missing runtime evidence.' }
        $events | & node (Join-Path $PSScriptRoot 'coop-world-report.cjs') --require-stock-raid --require-stock-wreck-loot --system-id $WorldSystemID
        if ($LASTEXITCODE -ne 0) {
            throw 'Unproven stock PvE chain: require actual native weapon, same-victim HP loss, physical EveJS wreck and nonempty stored loot. Real clients and final-hit attribution remain separate.'
        }
        Write-Host '[STOCK RAID LOOT] Native weapon, measured stock miner HP loss, physical wreck and saved loot are correlated. Two-client gameplay and killer identity are NOT proven.'
    }
    'LootPickup' {
        Assert-BackendPrerequisites
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22+ is required for native loot pickup proof.' }
        $options=Get-ComposeArgs
        $events=@(& docker compose @options exec -T server cat /var/lib/evejs/coop-events.jsonl 2>$null)
        if ($LASTEXITCODE -ne 0) { throw 'Missing native loot telemetry. Use DiagnoseWorld; do not reset the world.' }
        $events | & node (Join-Path $PSScriptRoot 'coop-world-report.cjs') --require-stock-raid --require-stock-wreck-loot --require-native-loot-pickup --system-id $WorldSystemID
        if ($LASTEXITCODE -ne 0) { throw 'No correlated real stock miner weapon, HP, physical wreck, stored loot and authenticated successful item withdrawal yet.' }
        Write-Host '[LOOT PICKUP] Native EveJS item grant and matching source debit verified for an authenticated character. Second-client rendering, duplicate withdrawal and final killer still require gameplay QA.'
    }
    'FinalBlow' {
        Assert-BackendPrerequisites
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22+ required for native source attribution.' }
        $options=Get-ComposeArgs
        $events=@(& docker compose @options exec -T server cat /var/lib/evejs/coop-events.jsonl 2>$null)
        if ($LASTEXITCODE -ne 0) { throw 'No native destruction evidence. Confirm LivingCoop runtime and inspect server logs.' }
        $events | & node (Join-Path $PSScriptRoot 'coop-world-report.cjs') --require-combat --require-weapon --require-final-attacker
        if ($LASTEXITCODE -ne 0) { throw 'EveJS did not prove an explicitly supplied native destruction attacker for the correlated weapon/HP/wreck/loot chain.' }
        Write-Host '[FINAL BLOW] EveJS explicitly provided a native destruction attacker linked to real weapon, HP loss, wreck and stored loot; verify client behavior separately.'
    }
    'Market' {
        Assert-BackendPrerequisites
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22+ is required for native NPC market evidence.' }
        $options=Get-ComposeArgs
        $events=@(& docker compose @options exec -T server cat /var/lib/evejs/coop-events.jsonl 2>$null)
        if ($LASTEXITCODE -ne 0) { throw 'No native market events. Enable the opt-in NPC market only on an isolated, backed-up test world.' }
        $events | & node (Join-Path $PSScriptRoot 'coop-world-report.cjs') --require-market --window-minutes 60
        if ($LASTEXITCODE -ne 0) { throw 'No native NPC seeded sale followed by purchased stock backed by earned ISK and physical cargo. See report.' }
        Write-Host '[MARKET] The same named native NPC settled a seeded sale and a stock purchase with real market daemon RPC and cargo. This does not certify independent NPC-owned player-market orders.'
    }
    'Logs' {
        Assert-BackendPrerequisites
        $folder = Join-Path $OutputRoot (Get-Timestamp)
        New-Item -ItemType Directory -Force -Path $folder | Out-Null
        $options=Get-ComposeArgs
        & docker compose @options ps --all *> (Join-Path $folder 'compose-ps.txt')
        & docker compose @options logs --no-color --tail 1000 init market server *> (Join-Path $folder 'compose.log')
        & git -C (Split-Path -Parent $CodePath) rev-parse HEAD *> (Join-Path $folder 'upstream-sha.txt')
        Write-Host "Local evidence: $folder"
        Write-Warning 'Review logs for account names, tokens, IPs, emails, and credentials before sharing. These files remain local and must not be committed.'
    }
    'Stop' {
        Assert-BackendPrerequisites
        Write-Warning 'Stop both client windows manually first. This does not terminate or kill client processes.'
        Invoke-Compose @('down')
        Write-Host 'Backend stopped. Named volumes preserved.'
        Publish-StateSnapshot -StateNote 'backend stopped (volumes preserved)' -StateNext 'restart with -Action Start or CoopStart'
    }
    'Publish' {
        # Full publish: local suite + overlay + server events + redacted client tail.
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22+ is required to publish session state.' }
        $publisher = Join-Path $PSScriptRoot 'Publish-SessionState.ps1'
        $publishNote = if ($Note) { $Note } else { 'manual state publish' }
        $publishNext = if ($Next) { $Next } else { 'read state/NOW.md and continue from there' }
        & $publisher -CodePath $CodePath -Note $publishNote -Next $publishNext
        if (-not $?) { throw 'Session state publish failed.' }
        Write-Host '[STATE] state/ updated; commit it so cloud sessions can see this run.'
    }
}
