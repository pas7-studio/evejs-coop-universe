"use strict";
// Read-only quality gate. Real client observations and authoritative persisted
// snapshots are external evidence, never inferred from JSONL or TCP sockets.
const fs = require('node:fs');
const {summarize: summarizeWorld} = require('./coop-world-report.cjs');
const {summarize: summarizeParty} = require('./coop-party-report.cjs');

const pass = (status, reason, detail = {}) => ({status, reason, ...detail});
const positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const canonicalId = value => /^[1-9][0-9]*$/.test(String(value)) && positive(value);
const validAt = value => Number.isFinite(Date.parse(value));
const decimal = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);
const signed = value => typeof value === 'string' && /^-?(0|[1-9][0-9]*)$/.test(value) && value !== '-0';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const requiredMeta = meta => meta && /^[a-f0-9]{40}$/.test(meta.projectSha || '') && /^[a-f0-9]{40}$/.test(meta.upstreamSha || '') && typeof meta.imageId === 'string' && meta.imageId.startsWith('sha256:') && meta.imageId.length > 12;

function parseEvents(raw, now, minutes) {
  let invalid = 0;
  const rows = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      const t = Date.parse(row.at);
      if (!row || typeof row.event !== 'string' || !Number.isFinite(t)) { invalid++; continue; }
      if (t >= now - minutes * 60000 && t <= now + 60000) rows.push({...row, _t: t});
    } catch { invalid++; }
  }
  rows.sort((a,b) => a._t - b._t);
  return {rows, invalid};
}
function checkWorld(raw, meta, now, minutes) {
  if (!raw || !String(raw).trim()) return pass('BLOCKED', 'MISSING_TELEMETRY: inspect effective running overlay with DiagnoseWorld');
  const parsed = parseEvents(raw, now, minutes);
  if (parsed.invalid) return pass('FAIL', 'Malformed or incomplete telemetry JSONL', {invalidLines: parsed.invalid});
  if (!parsed.rows.length) return pass('BLOCKED', 'No current telemetry within evidence window');
  const latestBoot = [...parsed.rows].reverse().find(e => e.event === 'living-headless-boot-requested');
  if (!latestBoot) return pass('BLOCKED', 'Headless startup hook event not observed in current window');
  const world = summarizeWorld(raw, {now, windowMinutes: minutes, requireActivity:true});
  if (world.status !== 'READY_FOR_CLIENT_PLAYTEST') return pass('BLOCKED', world.status, {
    worldStatus:world.status, activityStatus:world.activity?.status || null,
    scenery:world.scenery, missing:world.blockers?.slice(0,2) || []
  });
  return pass('PASS_SERVER', 'Real native topology, physical miners/haulers, named NPC and movement + interaction evidenced', {
    worldStatus:world.status, activityStatus:world.activity.status, scenery:world.scenery,
    physicalNpcShips:world.physicalNpcShipAssignments
  });
}
function checkParty(raw, now, minutes) {
  if (!raw || !String(raw).trim()) return pass('BLOCKED', 'No party event log');
  const party = summarizeParty(raw, {now, windowMinutes:minutes});
  if (party.invalidLines) return pass('FAIL', 'Malformed party telemetry', {invalidLines:party.invalidLines});
  const sceneAge = validAt(party.lastSceneAt) ? now - Date.parse(party.lastSceneAt) : Infinity;
  if (party.serverMutualVisibility !== true || party.sharedScenePilotCount !== 2 || party.activePilotCount < 2 || sceneAge < 0 || sceneAge > 5*60000)
    return pass('BLOCKED', 'Two fresh, independently identified pilots with mutual scene visibility not evidenced', {
      partyStatus:party.status, activePilots:party.activePilotCount,
      sharedScenePilots:party.sharedScenePilotCount, sceneFresh:sceneAge >= 0 && sceneAge <= 5*60000
    });
  return pass('PASS_SERVER', 'Two distinct sessions, ships and reciprocal server-side scene visibility observed', {
    activePilots:party.activePilotCount, sharedScenePilots:party.sharedScenePilotCount
  });
}
function validateSnapshot(snapshot, meta) {
  if (!snapshot || snapshot.source !== 'native-authoritative-export') throw Error('Snapshot requires native-authoritative-export provenance');
  if (snapshot.projectSha !== meta.projectSha || snapshot.upstreamSha !== meta.upstreamSha) throw Error('Snapshot SHA does not match tested revisions');
  if (!validAt(snapshot.capturedAt) || !Array.isArray(snapshot.characters) || snapshot.characters.length < 2) throw Error('Snapshot timestamp and two characters are mandatory');
  const chars = new Set(), ships = new Set(), items = new Set();
  const normalized = [];
  for (const c of snapshot.characters) {
    const id = String(c.id || ''), ship = String(c.shipId || '');
    if (!canonicalId(id) || !canonicalId(ship) || !canonicalId(c.systemId) || chars.has(id) || ships.has(ship) || !decimal(c.isk) || !Array.isArray(c.items)) throw Error('Invalid character, ship, wallet or duplicated ownership');
    chars.add(id); ships.add(ship);
    const assets = [];
    for (const item of c.items) {
      const itemId = String(item.id || '');
      if (!canonicalId(itemId) || items.has(itemId) || !canonicalId(item.typeId) || !positive(item.quantity) || !canonicalId(item.locationId)) throw Error('Duplicated, malformed or nonpositive item state');
      items.add(itemId);
      assets.push({id:itemId, typeId:String(item.typeId), quantity:String(item.quantity), locationId:String(item.locationId)});
    }
    assets.sort((a,b) => a.id.localeCompare(b.id));
    normalized.push({id, ship, systemId:String(c.systemId), isk:c.isk, assets});
  }
  normalized.sort((a,b) => a.id.localeCompare(b.id));
  const r = snapshot.runtime;
  if (!r || r.volumeName !== 'evejs-data' || r.imageId !== meta.imageId ||
    typeof r.containerId !== 'string' || r.containerId.length < 12 || !validAt(r.containerStartedAt) ||
    Date.parse(r.containerStartedAt) > Date.parse(snapshot.capturedAt))
    throw Error('Native snapshot requires verifiable Docker container, image, start time and preserved evejs-data volume');
  return {normalized, capturedAt:Date.parse(snapshot.capturedAt), startedAt:Date.parse(r.containerStartedAt)};
}
function checkPersistence(before, after, meta) {
  if (!before || !after) return pass('BLOCKED', 'Provide read-only authoritative before/after restart snapshots; restart NOT performed by gate');
  try {
    const a = validateSnapshot(before, meta), b = validateSnapshot(after, meta);
    if (b.capturedAt <= a.capturedAt) return pass('FAIL','After snapshot must be later than before snapshot');
    if (b.startedAt <= a.capturedAt) return pass('BLOCKED','No independent evidence of Docker server restart between the two snapshots');
    if (!same(a.normalized, b.normalized)) return pass('FAIL','Character ship, location, ISK or unique item state changed across claimed idle restart');
    return pass('PASS_SNAPSHOT', 'Server restart start-times and unchanged evejs-data volume evidenced; characters, items and balances unchanged', {characters:a.normalized.length});
  } catch(e) {return pass('FAIL', 'Invalid snapshot: '+e.message);}
}
function checkEconomy(ledger, meta) {
  if (!ledger) return pass('BLOCKED','Native authoritative transaction export not provided; no claim about absence of duplication');
  if (ledger.source !== 'native-authoritative-export' || ledger.projectSha !== meta.projectSha || ledger.upstreamSha !== meta.upstreamSha || !Array.isArray(ledger.entries))
    return pass('FAIL','Ledger provenance, revision or entries invalid');
  if (ledger.entries.length === 0) return pass('BLOCKED','No completed transactions available for economy validation');
  const entries = new Set(), rewards = new Map(), txs = new Map();
  for (const e of ledger.entries) {
    if (!e || typeof e.entryId !== 'string' || !e.entryId || entries.has(e.entryId) || typeof e.txId !== 'string' || !e.txId || typeof e.account !== 'string' || !e.account || !signed(e.delta) || !['transfer','mint','burn'].includes(e.kind))
      return pass('FAIL','Duplicate entry identity, invalid transaction or non-exact monetary delta');
    entries.add(e.entryId);
    const tx = txs.get(e.txId) || {sum:0n, kind:e.kind, count:0};
    if (tx.kind !== e.kind) return pass('FAIL','Mixed transaction kinds with same transaction ID');
    if (e.kind === 'mint' && BigInt(e.delta) <= 0n) return pass('FAIL','Mint contains nonpositive ledger entry');
    if (e.kind === 'burn' && BigInt(e.delta) >= 0n) return pass('FAIL','Burn contains nonnegative ledger entry');
    tx.sum += BigInt(e.delta); tx.count++;
    if (e.kind === 'mint') {
      if (typeof e.rewardKey !== 'string' || !e.rewardKey) return pass('FAIL','Mint has no unique reward/issuance key');
      if (rewards.has(e.rewardKey)) return pass('FAIL','Double reward issuance for same key');
      rewards.set(e.rewardKey,e.txId);
    }
    txs.set(e.txId, tx);
  }
  for (const tx of txs.values()) {
    if (tx.kind === 'transfer' && (tx.sum !== 0n || tx.count < 2)) return pass('FAIL','Unbalanced or incomplete transfer ledger');
    if (tx.kind === 'mint' && tx.sum <= 0n) return pass('FAIL','Nonpositive mint');
    if (tx.kind === 'burn' && tx.sum >= 0n) return pass('FAIL','Nonnegative burn');
  }
  return pass('PASS_LEDGER','All sampled transactions balance or have explicit issuance/destruction semantics; unique entry and reward keys', {transactions:txs.size, entries:entries.size});
}
function checkClient(observations, meta, now) {
  if (!observations) return pass('BLOCKED','Two-client authenticated gameplay needs actual operator-confirmed observations; no TCP/JSONL substitute');
  const fields = ['loginA','loginB','undockA','undockB','npcVisible','mutualVisibility','fleetWarp','combatOrLoot','reconnect'];
  if (observations.projectSha !== meta.projectSha || observations.upstreamSha !== meta.upstreamSha || observations.imageId !== meta.imageId ||
    observations.authorizedClient !== true || !validAt(observations.recordedAt) ||
    Math.abs(now-Date.parse(observations.recordedAt))>30*60000 ||
    !Array.isArray(observations.characterIds) || observations.characterIds.length !== 2 ||
    !observations.characterIds.every(positive) || String(observations.characterIds[0]) === String(observations.characterIds[1]) ||
    !observations.observations || !fields.every(x => observations.observations[x] === true))
    return pass('BLOCKED','Incomplete, stale or revision-mismatched human two-client gameplay attestation');
  return pass('PASS_OPERATOR_ATTESTED','Authorized operator attested actual two-client interaction, fleet warp, NPC interaction and reconnect');
}
function audit({events='',meta={},before=null,after=null,ledger=null,client=null,now=Date.now(),windowMinutes=30}={}) {
  if (!Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 1440) throw Error('Window must be 1..1440 minutes');
  if (!requiredMeta(meta)) return {overall:'BLOCKED_REVISION',reason:'Exact 40-char project/upstream SHA and running Docker image digest required',gates:{}};
  const gates = {
    world:checkWorld(events,meta,now,windowMinutes),
    party:checkParty(events,now,windowMinutes),
    persistence:checkPersistence(before,after,meta),
    economy:checkEconomy(ledger,meta),
    client:checkClient(client,meta,now)
  };
  const bad = Object.values(gates).some(g => g.status === 'FAIL');
  const complete = Object.values(gates).every(g => g.status.startsWith('PASS_'));
  return {overall:bad?'FAIL':complete?'PASS_WITH_OPERATOR_ATTESTATION':'BLOCKED',
    meta:{projectSha:meta.projectSha,upstreamSha:meta.upstreamSha,imageId:meta.imageId},
    windowMinutes,gateOrder:['world','party','persistence','economy','client'],gates,
    limits:['Server-side events cannot prove client rendering or native database truth.',
      'Persistence PASS requires two separately captured authoritative snapshots around an operator-approved idle restart.',
      'Economy PASS requires a native authoritative ledger export; empty/missing data stays BLOCKED.',
      'Operator attestation is not automated visual proof; no CI, redeploy, backup, restart, market rebuild or volume mutation occurs.']};
}
function cli(argv=process.argv.slice(2)) {
  const allowed=new Set(['--events','--meta','--before','--after','--ledger','--client','--out','--window-minutes']);
  const args={};
  for(let i=0;i<argv.length;i+=2){
    const k=argv[i]; if (!allowed.has(k)||!argv[i+1]||args[k]) throw Error('Unknown, duplicated or missing option: '+k);
    args[k]=argv[i+1];
  }
  const read=key=>args[key]?JSON.parse(fs.readFileSync(args[key],'utf8')):null;
  const events=args['--events']==='-'?fs.readFileSync(0,'utf8'):args['--events']?fs.readFileSync(args['--events'],'utf8'):'';
  const result=audit({events,meta:read('--meta')||{},before:read('--before'),after:read('--after'),ledger:read('--ledger'),client:read('--client'),windowMinutes:args['--window-minutes']?Number(args['--window-minutes']):30});
  const output=JSON.stringify(result,null,2)+'\n';
  if(args['--out']) fs.writeFileSync(args['--out'],output,{flag:'wx',mode:0o600});
  else process.stdout.write(output);
  process.exitCode=result.overall==='PASS_WITH_OPERATOR_ATTESTATION'?0:2;
}
if(require.main===module){try{cli();}catch(e){console.error('Reliability gate:',e.message);process.exitCode=2;}}
module.exports={audit,parseEvents,checkWorld,checkParty,checkPersistence,checkEconomy,checkClient,validateSnapshot,cli};