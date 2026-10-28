import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const WINDOWS = process.platform === 'win32';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/^\uFEFF/, '');
// PowerShell formats Write-Host output to the console width, so a long banner
// comes back wrapped mid-word. Compare text, not its layout.
const flat = (text) => String(text).replace(/\s+/g, '');

// Why this exists: the four Inspect-Coop probes all read one module's text,
// append a statement and run it inside the live server with
// `docker compose exec -T server node -e <base64>`. That plumbing is now one
// function, and the dangerous parts are invisible in review: node -e never runs
// require.main, base64 is the only quoting-safe transport, and -T keeps Docker
// from mangling the JSON. A real container is never needed to prove the shape -
// a PowerShell `docker` function (the probes run in-process) records the exact
// argv and returns a chosen exit code.

const RUNNER = 'eval(Buffer.from(process.argv[1],String.fromCharCode(98,97,115,101,54,52)).toString())';

// Each probe: its module, the statement it must append (documented behaviour),
// the separator it has always used, the extra container arguments, the two
// banner lines and the failure text quoted in the docs.
const PROBES = [
  {
    file: 'Inspect-Coop-ConvoyOperations.ps1',
    module: 'integration/coopConvoyOperations.cjs',
    init: 'const snapshot=module.exports.createOperations().snapshot();' +
      'console.log(JSON.stringify(snapshot,null,2));if(snapshot.status!=="READY")process.exitCode=2;',
    separator: '\r\n',
    extra: [],
    before: '[COOP CONVOY] Read-only native convoy incident journal (no Docker restart or asset mutation).',
    after: '[COOP CONVOY] DUO_INTERVENED means native participation evidence, NOT delivery or ISK reward.',
    missingCompose: 'Missing upstream compose.yaml',
    failed: 'Native convoy journal inspection blocked: Docker exit 5',
  },
  {
    file: 'Inspect-Coop-ConvoyOutcomes.ps1',
    module: 'integration/coopConvoyOutcomeProof.cjs',
    init: 'const out=module.exports.createOutcomes().snapshot();' +
      'console.log(JSON.stringify(out,null,2));if(out.status!=="READY")process.exitCode=2;',
    separator: '\r\n',
    extra: [],
    before: '[COOP CONVOY] Read-only native cargo / loss outcome receipts; no restart, credit or mutation.',
    after: '[COOP CONVOY] Stock stack != full convoy rescue; cargo and ISK remain native-authoritative.',
    missingCompose: 'Missing pinned EveJS compose.yaml',
    failed: 'Convoy outcome inspection failed: Docker exit 5',
  },
  {
    file: 'Inspect-Coop-Market.ps1',
    module: 'scripts/coop-market-inspect.cjs',
    init: "console.log(JSON.stringify(run({systems:process.argv[2].split(',').map(Number)}),null,2));",
    // This probe has always joined with a bare LF; keeping it avoids a pointless
    // payload change for a file whose bytes nobody needs to redesign.
    separator: '\n',
    extra: ['30100032,30000142'],
    params: {SolarSystems: '30100032,30000142'},
    before: '[COOP MARKET] Reading current SQLite market stock; no seed/rebuild/write/restart.',
    after: '[COOP MARKET] If stock is elsewhere, buy in that seeded station; ' +
      'orders must be fulfilled by native wallet/inventory settlement.',
    missingCompose: 'Missing upstream compose.yaml',
    failed: 'Market inspection failed, docker exit code 5',
  },
  {
    file: 'Inspect-Coop-MarketStation.ps1',
    module: 'scripts/coop-market-station-readiness.cjs',
    init: 'console.log(JSON.stringify(run({systemID:Number(process.argv[2]),' +
      'stationID:Number(process.argv[3]) || null}),null,2));',
    separator: '\r\n',
    extra: ['30100032', '0'],
    params: {SystemID: 30100032, StationID: 0},
    before: '[COOP MARKET] Native market SQLite READ-ONLY, system 30100032, station 0 (0 = list).',
    after: '[COOP MARKET] Stock evidence is NOT client buy proof; do not reseed/restart without permission.',
    missingCompose: 'Missing upstream compose.yaml',
    failed: 'Market station inspection failed: Docker exit 5',
  },
];

const HARNESS = `
param([string]$Probe,[string]$ComposeRoot,[int]$DockerExit,[string]$ParamsJson,[string]$OutFile)
$ErrorActionPreference='Stop'
$global:ProbeDockerExit=$DockerExit
$global:ProbeArgv=$null
# A simple function, so \`node -e\` stays a plain argument instead of binding to a
# common parameter such as -ErrorAction.
function global:docker { $global:ProbeArgv=@($args | ForEach-Object { [string]$_ }); $global:LASTEXITCODE=$global:ProbeDockerExit }
$splat=@{CodePath=$ComposeRoot}
foreach($p in (ConvertFrom-Json $ParamsJson).PSObject.Properties){ $splat[$p.Name]=$p.Value }
$out=''; $threw=''
try { $out=(& $Probe @splat *>&1 | Out-String -Width 500).Trim() } catch { $threw=$_.Exception.Message }
@{argv=$global:ProbeArgv; out=$out; threw=$threw} | ConvertTo-Json -Depth 5 | Set-Content -Path $OutFile -Encoding UTF8
`;

// Runs one probe in a private PowerShell session with the fake docker in place.
// `composeRoot` decides whether the probe finds compose.yaml at all.
function run(work, probe, {dockerExit = 0, composeExists = true, params = {}} = {}) {
  const composeRoot = path.join(work, composeExists ? 'code' : 'empty');
  fs.mkdirSync(path.join(composeRoot), {recursive: true});
  if (composeExists) fs.writeFileSync(path.join(composeRoot, 'compose.yaml'), 'services: {}\n');
  const outFile = path.join(work, `out-${Math.random().toString(16).slice(2)}.json`);
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(work, 'harness.ps1'), '-Probe', path.join(ROOT, 'scripts', probe.file),
    '-ComposeRoot', composeRoot, '-DockerExit', String(dockerExit),
    '-ParamsJson', JSON.stringify(params), '-OutFile', outFile], {encoding: 'utf8'});
  assert.equal(result.status, 0, `${probe.file} harness failed: ${result.stderr}`);
  const report = JSON.parse(fs.readFileSync(outFile, 'utf8').replace(/^\uFEFF/, ''));
  return {...report, composeRoot};
}

test('every Inspect-Coop probe sends the same documented command line and payload', (t) => {
  if (!WINDOWS) return t.skip('the probes are PowerShell + Docker on Windows');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'evejs-probe-'));
  try {
    fs.writeFileSync(path.join(work, 'harness.ps1'), HARNESS);
    for (const probe of PROBES) {
      const report = run(work, probe, {params: probe.params || {}});
      assert.equal(report.threw, '', `${probe.file} must not fail with a plausible container`);
      const argv = report.argv;
      assert.ok(Array.isArray(argv), `${probe.file} never called docker`);
      assert.deepEqual(argv.slice(0, 9), ['compose', '-f', path.join(report.composeRoot, 'compose.yaml'),
        'exec', '-T', 'server', 'node', '-e', RUNNER], `${probe.file} command line drifted`);
      // Read-only transport: the payload is exactly the module text plus the
      // statement that invokes its own inspector.
      const payload = Buffer.from(argv[9], 'base64').toString('utf8');
      assert.equal(payload, read(probe.module) + probe.separator + probe.init,
        `${probe.file} payload is not module + init`);
      assert.deepEqual(argv.slice(10), probe.extra, `${probe.file} container arguments drifted`);
      // Banners are operator-facing text quoted in docs. PowerShell wraps a
      // host line at the console width, so compare on flattened whitespace.
      assert.ok(flat(report.out).includes(flat(probe.before)), `${probe.file} lost its before banner`);
      assert.ok(flat(report.out).includes(flat(probe.after)), `${probe.file} lost its after banner`);
      // Nothing is printed after a failure.
      const failed = run(work, probe, {dockerExit: 5, params: probe.params || {}});
      assert.equal(failed.threw, probe.failed);
      assert.equal(failed.out, '', `${probe.file} must not print success banners after a failure`);
      // A wrong checkout is refused before Docker is involved at all.
      const missing = run(work, probe, {composeExists: false, params: probe.params || {}});
      assert.equal(missing.threw, probe.missingCompose);
      assert.equal(missing.argv, null, `${probe.file} touched docker without a pinned compose file`);
    }
  } finally {
    fs.rmSync(work, {recursive: true, force: true});
  }
});

test('the probe helper is the only place that builds the container command', () => {
  const helper = read('scripts/lib/CoopContainerProbe.ps1');
  assert.match(helper, /docker compose -f \$compose @ComposeArguments exec -T server node -e \$script:CoopProbeRunner \$encoded @Arguments/,
    'the single container invocation must stay in the shared helper');
  for (const probe of PROBES) {
    const text = read(path.join('scripts', probe.file));
    assert.ok(text.includes("'lib/CoopContainerProbe.ps1'"), `${probe.file} must use the shared helper`);
    assert.doesNotMatch(text, /ToBase64String|docker compose/, `${probe.file} still builds its own payload`);
  }
});

test('Market still validates its system list before any container work', (t) => {
  if (!WINDOWS) return t.skip('the probes are PowerShell + Docker on Windows');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'evejs-probe-'));
  try {
    fs.writeFileSync(path.join(work, 'harness.ps1'), HARNESS);
    const probe = PROBES.find((entry) => entry.file === 'Inspect-Coop-Market.ps1');
    const report = run(work, probe, {params: {SolarSystems: 'not-a-system'}});
    assert.equal(report.threw, 'SolarSystems must be 1-10 comma-separated positive IDs');
    assert.equal(report.argv, null);
  } finally {
    fs.rmSync(work, {recursive: true, force: true});
  }
});
