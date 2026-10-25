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
const requiredMeta = meta => meta && /^[a-f0-9]{40}$/.test(meta.projectSha || '') && /^[a-f0-9]{40}$/.test(meta.upstreamSha || '') && typeof meta.imageId === 'string' && /^sha256:[a-f0-9]{64}$/.test(meta.imageId) && validAt(meta.containerStartedAt);

function parseEvents(raw, now, minutes, since = -Infinity) {
  let invalid = 0;
  const rows = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      const t = Date.parse(row.at);
      if (!row || typeof row.event !== 'string' || !Number.isFinite(t)) { invalid++; continue; }
      if (t >= Math.max(now - minutes * 60000, since) && t <= now + 60000) rows.push({...row, _t: t});
    } catch { invalid++; }
  }
  rows.sort((a,b) => a._t - b._t);
  return {rows, invalid};
}
function runtimeEvents(raw, meta, now, minutes) {
  const started = Date.parse(meta.containerStartedAt);
  const all = parseEvents(raw, now, Math.max(minutes, Math.ceil((now - started) / 60000) + 2), started);
  const recent = all.rows.filter(e => e._t >= now - minutes * 60000);
  return {all, recent, started, input: all.rows.map(e => JSON.stringify(e)).join('\n')};
}
function sceneIdentity(rows) {
  const scene = [...rows].reverse().find(e => e.event === 'coop-shared-scene' && Array.isArray(e.pilots));
  if (!scene || scene.pilots.length !== 2 || scene.mutualVisibility !== true) return null;
  const ids = scene.pilots.map(p => String(p.characterID));
  const ships = scene.pilots.map(p => String(p.shipID));
  if (!ids.every(canonicalId) || !ships.every(canonicalId) ||
      new Set(ids).size !== 2 || new Set(ships).size !== 2 ||
      !scene.pilots.every(p => p.shipExists === true)) return null;
  return {ids, ships, at:scene._t};
}
function checkWorld(raw, meta, now, minutes) {
  if (!raw || !String(raw).trim()) return pass('BLOCKED', 'MISSING_TELEMETRY: inspect effective running overlay with DiagnoseWorld');
  const {all, recent, input, started} = runtimeEvents(raw,meta,now,minutes);
  if (all.invalid) return pass('FAIL', 'Malformed or incomplete telemetry JSONL', {invalidLines: all.invalid});
  if (!recent.length) return pass('BLOCKED', 'No current telemetry within evidence window');
  // Boot record can be older than the activity window, but must belong to THIS
  // real container process. A previous boot or a source flag alone cannot pass.
  const latestBoot = [...all.rows].reverse().find(e => e.event === 'living-headless-boot-requested');
  if (!latestBoot) return pass('BLOCKED', 'Current-container headless boot not evidenced (possibly truncated telemetry tail)');
  // The upstream World reporter applies its own time cutoff. Give it the
  // current Docker process history so its headless/topology/industry anchors
  // remain visible after long uptime. This must NOT widen the freshness gate:
  // recent measured native activity is checked independently below.
  const processMinutes = Math.max(minutes, Math.ceil((now - started) / 60000) + 2);
  // Consider every system with freshly measured native activity. The most
  // recent topology can belong to a different system, especially with two
  // configured headless routes. Never combine evidence across systems.
  const fresh = recent.filter(e => e.event === 'living-native-activity' &&
    e.status === 'SAMPLED' && e._t >= latestBoot._t && positive(e.systemID));
  const systemIds = [...new Set(fresh.map(e => Number(e.systemID)))];
  const candidates = systemIds.map(systemID => {
    const world = summarizeWorld(input, {now, windowMinutes:processMinutes,
      requireActivity:true, systemID});
    const samples = fresh.filter(e => Number(e.systemID) === systemID);
    return {systemID,world,samples,
      movement:samples.some(e => Number(e.observedMovement) > 0),
      interaction:samples.some(e => Number(e.oreGrowth) > 0 || Number(e.engagedNativeNpcs) > 0),
      physical:samples.some(e => Number(e.physicalNpcShips) > 0)};
  });
  const winner = candidates.find(c => c.world.status === 'READY_FOR_CLIENT_PLAYTEST' &&
    c.movement && c.interaction && c.physical);
  if (winner) return pass('PASS_SERVER',
    'Boot-anchored native world with fresh same-system physical NPC movement and interaction', {
      systemID:winner.systemID, worldStatus:winner.world.status,
      activityStatus:winner.world.activity?.status||null,scenery:winner.world.scenery,
      physicalNpcShips:winner.world.physicalNpcShipAssignments,
      freshSamples:winner.samples.length
    });
  const best = candidates.find(c => c.world.status === 'READY_FOR_CLIENT_PLAYTEST');
  if (best) return pass('BLOCKED',
    'No fresh same-system measured native NPC movement and interaction in requested evidence window', {
      systemID:best.systemID, freshSamples:best.samples.length,
      freshMovement:best.movement, freshInteraction:best.interaction,
      freshPhysicalShips:best.physical
    });
  // A missing / unready system is never promoted by another system's scene.
  const world = candidates[0]?.world || summarizeWorld(input, {
    now,windowMinutes:processMinutes,requireActivity:true});
  return pass('BLOCKED',world.status, {
    worldStatus:world.status, activityStatus:world.activity?.status||null,
    scenery:world.scenery, missing:world.blockers?.slice(0,2)||[],
    freshSystemCandidates:systemIds.length
  });
}
function checkParty(raw, meta, now, minutes) {
  if (!raw || !String(raw).trim()) return pass('BLOCKED', 'No party event log');
  const {all, recent, input} = runtimeEvents(raw,meta,now,minutes);
  if (all.invalid) return pass('FAIL', 'Malformed party telemetry', {invalidLines:all.invalid});
  const party = summarizeParty(input, {now, windowMinutes:minutes});
  const identity = sceneIdentity(recent);
  const sceneAge = identity ? now - identity.at : Infinity;
  const laterBoot = identity && all.rows.some(e => e.event === 'living-headless-boot-requested' && e._t > identity.at);
  if (party.serverMutualVisibility !== true || party.sharedScenePilotCount !== 2 ||
      party.activePilotCount !== 2 || !identity || laterBoot || sceneAge < 0 || sceneAge > 5*60000)
    return pass('BLOCKED', 'Two fresh distinct pilots and ships with mutual scene visibility not evidenced', {
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
  const chars = new Set(), accounts = new Set(), ships = new Set(), items = new Set();
  const normalized = [];
  for (const c of snapshot.characters) {
    const id = String(c.id || ''), ship = String(c.shipId || ''), accountId=String(c.accountId || '');
    if (!canonicalId(id) || !canonicalId(accountId) || !canonicalId(ship) || !canonicalId(c.systemId) || chars.has(id) || accounts.has(accountId) || ships.has(ship) || !decimal(c.isk) || !Array.isArray(c.items)) throw Error('Invalid character, account, ship, wallet or duplicated ownership');
    chars.add(id); accounts.add(accountId); ships.add(ship);
    const assets = [];
    for (const item of c.items) {
      const itemId = String(item.id || '');
      if (!canonicalId(itemId) || items.has(itemId) || !canonicalId(item.typeId) || !positive(item.quantity) || !canonicalId(item.locationId)) throw Error('Duplicated, malformed or nonpositive item state');
      items.add(itemId);
      const categoryId = item.categoryId == null ? null : String(item.categoryId);
      if (categoryId !== null && !canonicalId(categoryId)) throw Error('Malformed native item category');
      assets.push({id:itemId, typeId:String(item.typeId), categoryId, quantity:String(item.quantity), locationId:String(item.locationId)});
    }
    assets.sort((a,b) => a.id.localeCompare(b.id));
    if (!assets.some(asset => asset.id===ship && asset.categoryId==='6')) throw Error('Active native ship must exist as one owned ship-category inventory item');
    normalized.push({id, accountId, ship, systemId:String(c.systemId), isk:c.isk, assets});
  }
  normalized.sort((a,b) => a.id.localeCompare(b.id));
  const r = snapshot.runtime;
  if (!r || r.volumeName !== 'evejs-data' || r.imageId !== meta.imageId ||
    typeof r.containerId !== 'string' || r.containerId.length < 12 || !validAt(r.containerStartedAt) ||
    Date.parse(r.containerStartedAt) > Date.parse(snapshot.capturedAt))
    throw Error('Native snapshot requires verifiable Docker container, image, start time and preserved evejs-data volume');
  return {normalized, capturedAt:Date.parse(snapshot.capturedAt), startedAt:Date.parse(r.containerStartedAt)};
}
function checkPersistence(before, after, meta, expectedIds = null) {
  if (!before || !after) return pass('BLOCKED', 'Provide read-only authoritative before/after restart snapshots; restart NOT performed by gate');
  try {
    const a = validateSnapshot(before, meta), b = validateSnapshot(after, meta);
    if (expectedIds && !expectedIds.every(id => a.normalized.some(c => c.id === id) && b.normalized.some(c => c.id === id))) return pass('FAIL','Persisted character identities do not match the two observed co-op pilots');
    if (b.capturedAt <= a.capturedAt) return pass('FAIL','After snapshot must be later than before snapshot');
    if (b.startedAt <= a.capturedAt) return pass('BLOCKED','No independent evidence of Docker server restart between the two snapshots');
    if (!same(a.normalized, b.normalized)) return pass('FAIL','Character ship, location, ISK or unique item state changed across claimed idle restart');
    return pass('PASS_SNAPSHOT', 'Server restart start-times and unchanged evejs-data volume evidenced; characters, items and balances unchanged', {characters:a.normalized.length});
  } catch(e) {return pass('FAIL', 'Invalid snapshot: '+e.message);}
}
// Pairwise read-only native custody audit. Capture both gifts in an idle
// window, with exactly one ordinary item and one inactive ship changing owner.
// This is stronger than an operator screenshot and weaker than observing a
// crash-safe atomic gift transaction: no server write is performed here.
function checkGifts(before, after, meta, expectedIds = null) {
  if (!before || !after) return pass('BLOCKED','Capture native before/after snapshots around one ordinary item gift and one inactive ship gift; no game mutation performed by QA');
  try {
    const a=validateSnapshot(before,meta), b=validateSnapshot(after,meta);
    if (b.capturedAt <= a.capturedAt) return pass('FAIL','Gift after-snapshot must follow before-snapshot');
    // A same-process pair avoids mistaking a restart or unrelated session
    // transfer for a deliberate docked player-to-player gift.
    if (before.runtime.containerId !== after.runtime.containerId || a.startedAt !== b.startedAt)
      return pass('BLOCKED','Gift evidence must be captured within the same running Docker server process');
    const ids=a.normalized.map(p=>p.id);
    if (expectedIds && (ids.length!==expectedIds.length || !expectedIds.every(id=>ids.includes(id))))
      return pass('FAIL','Gift actors do not match actual two-pilot shared-scene IDs');
    if (a.normalized.length!==2 || b.normalized.length!==2 || !same(ids,b.normalized.map(p=>p.id)))
      return pass('FAIL','Gift snapshots must contain the same two native characters');
    for (let i=0;i<2;i++) {
      const first=a.normalized[i], second=b.normalized[i];
      if (first.accountId!==second.accountId || first.ship!==second.ship || first.systemId!==second.systemId || first.isk!==second.isk)
        return pass('FAIL','Unexpected account, active ship, system or wallet change during gift proof');
    }
    const inventory=players=>{
      const m=new Map();
      for (const owner of players) for (const asset of owner.assets) {
        if (m.has(asset.id)) throw Error('Duplicate global item identity');
        m.set(asset.id,{ownerId:owner.id,...asset});
      }
      return m;
    };
    const beforeItems=inventory(a.normalized), afterItems=inventory(b.normalized);
    if (beforeItems.size!==afterItems.size || [...beforeItems.keys()].some(id=>!afterItems.has(id)))
      return pass('FAIL','Gift window created or destroyed a native item instance');
    const moved=[];
    for (const [id,item] of beforeItems) {
      const next=afterItems.get(id);
      if (item.typeId!==next.typeId || item.categoryId!==next.categoryId || item.quantity!==next.quantity)
        return pass('FAIL','Gift changed item type, category or quantity');
      if (item.ownerId===next.ownerId) {
        if (item.locationId!==next.locationId) return pass('FAIL','Unrelated item location changed in gift window');
        continue;
      }
      if (!ids.includes(next.ownerId) || !ids.includes(item.ownerId) || item.ownerId===next.ownerId)
        return pass('FAIL','Invalid native item owner transition');
      if (a.normalized.some(p=>p.ship===id)) return pass('FAIL','Gift cannot take away a player active ship');
      moved.push({id,kind:item.categoryId==='6'?'ship':'item',from:item.ownerId,to:next.ownerId});
    }
    if (moved.length!==2 || moved.filter(m=>m.kind==='item').length!==1 || moved.filter(m=>m.kind==='ship').length!==1)
      return pass('BLOCKED','Require precisely one identifiable item instance and one inactive ship instance transferred between the two real pilots');
    return pass('PASS_CUSTODY','Native SQLite confirms exactly one item gift and one inactive ship ownership transfer without cloning or extra ISK', {movements:moved});
  } catch(error) {return pass('FAIL','Invalid native gift snapshots: '+error.message);}
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
    const tx = txs.get(e.txId) || {sum:0n, kind:e.kind, count:0, accounts:new Set(), positive:0, negative:0};
    if (tx.kind !== e.kind) return pass('FAIL','Mixed transaction kinds with same transaction ID');
    if (e.kind === 'mint' && BigInt(e.delta) <= 0n) return pass('FAIL','Mint contains nonpositive ledger entry');
    if (e.kind === 'burn' && BigInt(e.delta) >= 0n) return pass('FAIL','Burn contains nonnegative ledger entry');
    if (BigInt(e.delta) === 0n) return pass('FAIL','Zero-value monetary entry is not valid evidence');
    tx.sum += BigInt(e.delta); tx.count++; tx.accounts.add(e.account);
    if (BigInt(e.delta) > 0n) tx.positive++; else tx.negative++;
    if (e.kind === 'mint') {
      if (typeof e.rewardKey !== 'string' || !e.rewardKey) return pass('FAIL','Mint has no unique reward/issuance key');
      if (rewards.has(e.rewardKey)) return pass('FAIL','Double reward issuance for same key');
      rewards.set(e.rewardKey,e.txId);
    }
    txs.set(e.txId, tx);
  }
  for (const tx of txs.values()) {
    if (tx.kind === 'transfer' && (tx.sum !== 0n || tx.count < 2 || tx.accounts.size < 2 || !tx.positive || !tx.negative)) return pass('FAIL','Unbalanced or incomplete transfer ledger');
    if (tx.kind === 'mint' && tx.sum <= 0n) return pass('FAIL','Nonpositive mint');
    if (tx.kind === 'burn' && tx.sum >= 0n) return pass('FAIL','Nonnegative burn');
  }
  return pass('PASS_LEDGER','All sampled transactions balance or have explicit issuance/destruction semantics; unique entry and reward keys', {transactions:txs.size, entries:entries.size});
}
function checkClient(observations, meta, now, expectedIds = null) {
  if (!observations) return pass('BLOCKED','Two-client authenticated gameplay needs actual operator-confirmed observations; no TCP/JSONL substitute');
  const fields = ['loginA','loginB','undockA','undockB','npcVisible','mutualVisibility','fleetInviteAccepted','fleetWarp','sharedCombat','sharedLoot','itemGift','shipGift','sharedQuestCredit','reconnectRetainsShip','secondPilotSurvivesDisconnect'];
  if (observations.projectSha !== meta.projectSha || observations.upstreamSha !== meta.upstreamSha || observations.imageId !== meta.imageId ||
    observations.authorizedClient !== true || !validAt(observations.recordedAt) ||
    Math.abs(now-Date.parse(observations.recordedAt))>30*60000 ||
    !Array.isArray(observations.characterIds) || observations.characterIds.length !== 2 ||
    !observations.characterIds.every(positive) || String(observations.characterIds[0]) === String(observations.characterIds[1]) ||
    (expectedIds && !expectedIds.every(id => observations.characterIds.some(x => String(x) === id))) ||
    !observations.observations || !fields.every(x => observations.observations[x] === true))
    return pass('BLOCKED','Incomplete, stale or revision-mismatched human two-client gameplay attestation');
  return pass('PASS_OPERATOR_ATTESTED','Authorized operator attested actual two-client fleet, item/ship transfers, shared missions/combat/loot and safe reconnect');
}
function audit({events='',meta={},before=null,after=null,giftBefore=null,giftAfter=null,ledger=null,client=null,now=Date.now(),windowMinutes=30}={}) {
  if (!Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 1440) throw Error('Window must be 1..1440 minutes');
  if (!requiredMeta(meta)) return {overall:'BLOCKED_REVISION',reason:'Exact project/upstream SHA, running Docker image and real container start required',gates:{}};
  const context = runtimeEvents(events,meta,now,windowMinutes);
  const identity = sceneIdentity(context.recent);
  const expectedIds = identity?.ids || null;
  const gates = {
    world:checkWorld(events,meta,now,windowMinutes),
    party:checkParty(events,meta,now,windowMinutes),
    persistence:checkPersistence(before,after,meta,expectedIds),
    gifts:checkGifts(giftBefore,giftAfter,meta,expectedIds),
    economy:checkEconomy(ledger,meta),
    client:checkClient(client,meta,now,expectedIds)
  };
  const bad = Object.values(gates).some(g => g.status === 'FAIL');
  const complete = Object.values(gates).every(g => g.status.startsWith('PASS_'));
  return {overall:bad?'FAIL':complete?'PASS_WITH_OPERATOR_ATTESTATION':'BLOCKED',
    meta:{projectSha:meta.projectSha,upstreamSha:meta.upstreamSha,imageId:meta.imageId,containerStartedAt:meta.containerStartedAt},
    windowMinutes,gateOrder:['world','party','persistence','gifts','economy','client'],gates,
    limits:['Server-side events cannot prove client rendering or native database truth.',
      'Persistence PASS requires two separately captured authoritative snapshots around an operator-approved idle restart.',
      'Economy PASS requires a native authoritative ledger export; empty/missing data stays BLOCKED.',
      'Operator attestation is not automated visual proof; no CI, redeploy, backup, restart, market rebuild or volume mutation occurs.']};
}
function cli(argv=process.argv.slice(2)) {
  const allowed=new Set(['--events','--meta','--before','--after','--gift-before','--gift-after','--ledger','--client','--out','--window-minutes']);
  const args={};
  for(let i=0;i<argv.length;i+=2){
    const k=argv[i]; if (!allowed.has(k)||!argv[i+1]||args[k]) throw Error('Unknown, duplicated or missing option: '+k);
    args[k]=argv[i+1];
  }
  const read=key=>args[key]?JSON.parse(fs.readFileSync(args[key],'utf8')):null;
  const events=args['--events']==='-'?fs.readFileSync(0,'utf8'):args['--events']?fs.readFileSync(args['--events'],'utf8'):'';
  const result=audit({events,meta:read('--meta')||{},before:read('--before'),after:read('--after'),giftBefore:read('--gift-before'),giftAfter:read('--gift-after'),ledger:read('--ledger'),client:read('--client'),windowMinutes:args['--window-minutes']?Number(args['--window-minutes']):30});
  const output=JSON.stringify(result,null,2)+'\n';
  if(args['--out']) fs.writeFileSync(args['--out'],output,{flag:'wx',mode:0o600});
  else process.stdout.write(output);
  process.exitCode=result.overall==='PASS_WITH_OPERATOR_ATTESTATION'?0:2;
}
if(require.main===module){try{cli();}catch(e){console.error('Reliability gate:',e.message);process.exitCode=2;}}
module.exports={audit,parseEvents,checkWorld,checkParty,checkPersistence,checkEconomy,checkClient,checkGifts,validateSnapshot,cli};