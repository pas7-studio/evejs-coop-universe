#Requires -Version 5.1
<#
.SYNOPSIS
  Run the agent work stack: a second EveJS world that is NOT the owner's.

.DESCRIPTION
  The owner's play server is compose project `evejs` on 127.0.0.1:443/5222/
  26000-26002/40110 with volumes evejs-data/evejs-images. This script never
  addresses that project: it always uses `-p evejs-agents`, host ports
  28443/25222/28000-28002/41110 and volumes evejs-agents-data/evejs-images.

  Why: agents rebuild and recreate containers for live proofs. Doing that to the
  owner's stack kicks him and his friend out of a running session.

  `-Action Status` is read-only. `-Action Up` refuses to start if any agent port
  is already taken, so a half-created stack cannot silently steal a port.
#>
[CmdletBinding()]
param(
  [ValidateSet('Status','Seed','Up','Down')]
  [string]$Action='Status',
  [string]$CodePath='C:\Games\EveCoop\upstream-evejs\Code',
  [string]$Image='evejs-local',
  [int[]]$Ports=@(28000,28001,28002,28443,25222,41110)
)
$ErrorActionPreference='Stop'
$project='evejs-agents'
$repoRoot=Split-Path -Parent $PSScriptRoot
$override=Join-Path $repoRoot 'compose\compose.agents.yaml'
$compose=Join-Path $CodePath 'compose.yaml'
$overlay=Join-Path $CodePath 'compose.coop-probe.yaml'

if(-not (Test-Path -LiteralPath $compose -PathType Leaf)){throw "Missing upstream compose.yaml: $compose"}
if(-not (Test-Path -LiteralPath $override -PathType Leaf)){throw "Missing agent override: $override"}

$files=@('-f',$compose)
if(Test-Path -LiteralPath $overlay -PathType Leaf){$files+=@('-f',$overlay)}
$files+=@('-f',$override)
$composeArgs=@('-p',$project,'--project-directory',$CodePath)+$files

function Get-AgentContainers {
  & docker ps -a --filter "label=com.docker.compose.project=$project" --format '{{.Names}}|{{.Status}}|{{.Ports}}'
}

switch($Action){
  'Status' {
    "project: $project"
    $rows=Get-AgentContainers
    if(-not $rows){'no agent containers (stack is down)'} else {$rows}
    break
  }
  'Seed' {
    # A brand-new agent volume has no market database, and the market container
    # exits 1 with "No market database exists". This is the documented one-time
    # seed (docs/FIRST_RUN.md). It never runs on the owner's project.
    & docker compose @composeArgs --profile tools run --rm --no-deps market-tools rebuild v1 --preset jita_new_caldari
    if($LASTEXITCODE -ne 0){throw 'market seed failed for the agent stack'}
    'AGENT_MARKET_SEEDED'
    break
  }
  'Up' {
    $busy=@()
    foreach($p in $Ports){
      $c=Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue
      if($c){$busy+=$p}
    }
    if($busy.Count -gt 0){throw "Agent ports already in use: $($busy -join ', '). Refusing to start; check the owner's stack is not holding them."}
    & docker image inspect $Image *> $null
    if($LASTEXITCODE -ne 0){throw "Image $Image is missing. Build it first: cd $CodePath; docker build -t $Image ."}
    'config check:'
    & docker compose @composeArgs config --quiet
    if($LASTEXITCODE -ne 0){throw 'docker compose config rejected the agent override'}
    'CONFIG_OK'
    & docker compose @composeArgs up -d
    if($LASTEXITCODE -ne 0){throw 'docker compose up failed for the agent stack'}
    'AGENT_STACK_UP'
    Get-AgentContainers
    break
  }
  'Down' {
    & docker compose @composeArgs down
    if($LASTEXITCODE -ne 0){throw 'docker compose down failed for the agent stack'}
    'AGENT_STACK_DOWN'
    break
  }
}
