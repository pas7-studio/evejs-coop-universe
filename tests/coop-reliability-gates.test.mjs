import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {audit, checkPersistence, checkEconomy, checkWorld, checkParty, checkClient, checkGifts, parseEvents} = require('../scripts/coop-reliability-gates.cjs');
const now=Date.parse('2026-10-25T11:00:00Z');
const meta={projectSha:'a'.repeat(40),upstreamSha:'b'.repeat(40),imageId:'sha256:'+'c'.repeat(64),containerStartedAt:'2026-10-25T09:00:00Z'};
const event=(event,props={},time=now-10000)=>JSON.stringify({event,at:new Date(time).toISOString(),systemID:30000142,...props});
const worldLog=[event('living-headless-boot-requested'),event('living-world-topology',{realWaypoints:8,realAsteroidBelts:2}),event('living-native-industry',{fleets:[{minerIDs:[101],haulerIDs:[102]}]}),event('virtual-world-materialization',{livingShips:[{entityID:103,pilotID:'coop-pilot-003',role:'pirate'}]}),event('living-native-activity',{status:'SAMPLED',observedMovement:2,oreGrowth:2,physicalNpcShips:3})].join('\n');
const partyLog=[event('space-login-attach',{characterID:101,shipID:1001}),event('space-login-attach',{characterID:102,shipID:1002}),event('coop-shared-scene',{mutualVisibility:true,pilots:[{characterID:101,shipID:1001,shipExists:true},{characterID:102,shipID:1002,shipExists:true}]})].join('\n');
function snapshot(at, startedAt,changes={}) {return {
  source:'native-authoritative-export',projectSha:meta.projectSha,upstreamSha:meta.upstreamSha,
  capturedAt:at, runtime:{volumeName:'evejs-data',containerId:'f'.repeat(64),imageId:meta.imageId,containerStartedAt:startedAt},
  characters:[
    {id:101,accountId:201,shipId:3001,systemId:30000142,isk:'100000',items:[
      {id:3001,typeId:603,categoryId:6,quantity:1,locationId:30000142},
      {id:1001,typeId:34,categoryId:18,quantity:500,locationId:3001},
      {id:4001,typeId:603,categoryId:6,quantity:1,locationId:3001}
    ]},
    {id:102,accountId:202,shipId:3002,systemId:30000142,isk:'200000',items:[
      {id:3002,typeId:604,categoryId:6,quantity:1,locationId:30000142},
      {id:1002,typeId:35,categoryId:18,quantity:100,locationId:3002}
    ]}
  ],...changes
};}
const before=snapshot('2026-10-25T10:00:00Z','2026-10-25T09:00:00Z');
const after=snapshot('2026-10-25T10:15:00Z','2026-10-25T10:05:00Z');
const giftBefore=snapshot('2026-10-25T10:30:00Z','2026-10-25T10:05:00Z');
const giftAfter=structuredClone(giftBefore);
giftAfter.capturedAt='2026-10-25T10:40:00Z';
for(const id of [1001,4001]){
  const index=giftAfter.characters[0].items.findIndex(x=>x.id===id);
  const [moved]=giftAfter.characters[0].items.splice(index,1);
  moved.locationId=3002;
  giftAfter.characters[1].items.push(moved);
}
const ledger={source:'native-authoritative-export',projectSha:meta.projectSha,upstreamSha:meta.upstreamSha,entries:[
 {entryId:'a',txId:'move1',account:'101',delta:'-200',kind:'transfer'},
 {entryId:'b',txId:'move1',account:'102',delta:'200',kind:'transfer'},
 {entryId:'c',txId:'mission7',account:'101',delta:'1000',kind:'mint',rewardKey:'mission:7:character:101'}]};
const client={projectSha:meta.projectSha,upstreamSha:meta.upstreamSha,imageId:meta.imageId,authorizedClient:true,recordedAt:new Date(now).toISOString(),characterIds:[101,102],observations:{loginA:true,loginB:true,undockA:true,undockB:true,npcVisible:true,mutualVisibility:true,fleetInviteAccepted:true,fleetWarp:true,sharedCombat:true,sharedLoot:true,itemGift:true,shipGift:true,sharedQuestCredit:true,reconnectRetainsShip:true,secondPilotSurvivesDisconnect:true}};
test('metadata is mandatory: no old PASS can be applied to unanchored deployment',()=>assert.equal(audit({events:worldLog,now}).overall,'BLOCKED_REVISION'));
test('missing event file is telemetry blocker, not client blocker',()=>assert.match(checkWorld('',meta,now,30).reason,/MISSING_TELEMETRY/));
test('malformed JSONL is fail closed',()=>assert.equal(checkWorld(worldLog+'\n{broken',meta,now,30).status,'FAIL'));
test('stale telemetry is blocked',()=>assert.equal(checkWorld(event('living-headless-boot-requested',{},now-4000000),meta,now,30).status,'BLOCKED'));
test('unbooted fake topology cannot qualify',()=>assert.equal(checkWorld(worldLog.split('\n').slice(1).join('\n'),meta,now,30).status,'BLOCKED'));
test('only observed physical world activity is server pass',()=>assert.equal(checkWorld(worldLog,meta,now,30).status,'PASS_SERVER'));
test('two authenticated-looking TCP sockets do not qualify as shared scene',()=>assert.equal(checkParty(event('tcp-reconnected'),meta,now,30).status,'BLOCKED'));
test('recent mutual scene qualifies only server-side, not a real client',()=>assert.equal(checkParty(partyLog,meta,now,30).status,'PASS_SERVER'));
test('stale shared scene is blocked even with two previous pilots',()=>assert.equal(checkParty(partyLog.replaceAll('2026-10-25T10:59:50.000Z','2026-10-25T10:50:00.000Z'),meta,now,30).status,'BLOCKED'));
test('unaltered authoritative state across evidenced restart qualifies snapshot only',()=>assert.equal(checkPersistence(before,after,meta).status,'PASS_SNAPSHOT'));
test('a later snapshot without restart evidence is blocked',()=>assert.equal(checkPersistence(before,snapshot('2026-10-25T10:15:00Z','2026-10-25T09:00:00Z'),meta).status,'BLOCKED'));
test('identical ID in two cargo owners fails',()=>{const s=structuredClone(after);s.characters[1].items[0].id=1001; assert.equal(checkPersistence(before,s,meta).status,'FAIL');});
test('unexpected ISK creation or item loss during idle restart fails',()=>{const s=structuredClone(after);s.characters[0].isk='100001';assert.equal(checkPersistence(before,s,meta).status,'FAIL');const t=structuredClone(after);t.characters[1].items=[];assert.equal(checkPersistence(before,t,meta).status,'FAIL');});
test('negative balances or fractional and invalid item quantities are rejected',()=>{const s=structuredClone(after);s.characters[0].isk='-1';assert.equal(checkPersistence(before,s,meta).status,'FAIL');const t=structuredClone(after);t.characters[0].items[0].quantity=0;assert.equal(checkPersistence(before,t,meta).status,'FAIL');});
test('unbalanced transfer is rejected using exact integer arithmetic',()=>{const x=structuredClone(ledger);x.entries[1].delta='201';assert.equal(checkEconomy(x,meta).status,'FAIL');});
test('double mission reward with a different txId fails',()=>{const x=structuredClone(ledger);x.entries.push({entryId:'d',txId:'mission7b',account:'101',delta:'1000',kind:'mint',rewardKey:'mission:7:character:101'});assert.equal(checkEconomy(x,meta).status,'FAIL');});
test('identical entry ID replays fail',()=>{const x=structuredClone(ledger);x.entries.push({...x.entries[0]});assert.equal(checkEconomy(x,meta).status,'FAIL');});
test('exact balanced ledger and explicit mint qualify only ledger integrity',()=>assert.equal(checkEconomy(ledger,meta).status,'PASS_LEDGER'));
test('no ledger gives BLOCKED, never clean economy',()=>assert.equal(checkEconomy(null,meta).status,'BLOCKED'));
test('outdated operator attestation cannot certify gameplay',()=>{const x=structuredClone(client);x.recordedAt='2026-10-24T11:00:00Z';assert.equal(checkClient(x,meta,now).status,'BLOCKED');});
test('two different authorized operator-observed clients qualify only attestation',()=>assert.equal(checkClient(client,meta,now).status,'PASS_OPERATOR_ATTESTED'));
test('complete evidence never reports automated visual proof',()=>{const report=audit({events:worldLog+'\n'+partyLog,meta,before,after,giftBefore,giftAfter,ledger,client,now});assert.equal(report.overall,'PASS_WITH_OPERATOR_ATTESTATION');assert.equal(report.gates.client.status,'PASS_OPERATOR_ATTESTED');});
test('missing any of the five gates keeps overall BLOCKED',()=>{const report=audit({events:worldLog+'\n'+partyLog,meta,before,after,giftBefore,giftAfter,client,now});assert.equal(report.overall,'BLOCKED');assert.equal(report.gates.economy.status,'BLOCKED');});
test('valid event rows are bounded by window and rejects malformed timestamps',()=>{const out=parseEvents(event('x')+'\n'+JSON.stringify({event:'a',at:'bad'}),now,30);assert.equal(out.invalid,1);assert.equal(out.rows.length,1);});

test('duplicate reward key inside one transaction also fails',()=>{const x=structuredClone(ledger);x.entries.push({entryId:'new',txId:'mission7',account:'102',delta:'1000',kind:'mint',rewardKey:'mission:7:character:101'});assert.equal(checkEconomy(x,meta).status,'FAIL');});
test('a mint transaction can contain distinct issuance keys',()=>{const x=structuredClone(ledger);x.entries.push({entryId:'new',txId:'mission7',account:'102',delta:'1000',kind:'mint',rewardKey:'mission:7:character:102'});assert.equal(checkEconomy(x,meta).status,'PASS_LEDGER');});
test('noncanonical duplicate item identifiers are rejected',()=>{const x=structuredClone(after);x.characters[1].items[0].id='01001';assert.equal(checkPersistence(before,x,meta).status,'FAIL');});
test('scene from before new server boot cannot pass party gate',()=>{const input=partyLog+'\n'+event('living-headless-boot-requested',{},now-5000);assert.equal(checkParty(input,meta,now,30).status,'BLOCKED');});
test('missing shared loot or ship gift never qualifies full coop',()=>{const x=structuredClone(client);x.observations.sharedLoot=false;assert.equal(checkClient(x,meta,now).status,'BLOCKED');const y=structuredClone(client);y.observations.shipGift=false;assert.equal(checkClient(y,meta,now).status,'BLOCKED');});

// Runtime-epoch and observed-identity security regressions.
test('world boot may be older than the short activity window if still same process',()=>{
 const input=worldLog.replace('living-headless-boot-requested', 'living-headless-boot-requested');
 const lines=input.split('\n');lines[0]=event('living-headless-boot-requested',{},now-3600000);
 assert.equal(checkWorld(lines.join('\n'),meta,now,30).status,'PASS_SERVER');
});
test('events emitted before current Docker process cannot pass World',()=>{
 const x={...meta,containerStartedAt:'2026-10-25T11:01:00Z'};
 assert.equal(checkWorld(worldLog,x,now,30).status,'BLOCKED');
});
test('party must show two distinct native ship IDs',()=>{
 const x=partyLog.replaceAll('shipID":1002','shipID":1001');
 assert.equal(checkParty(x,meta,now,30).status,'BLOCKED');
});
test('party previous-process scene must be ignored',()=>{
 const x={...meta,containerStartedAt:'2026-10-25T11:01:00Z'};
 assert.equal(checkParty(partyLog,x,now,30).status,'BLOCKED');
});
test('client identity must match the actual pair seen in native scene',()=>{
 const x=structuredClone(client);x.characterIds=[101,999];
 assert.equal(audit({events:worldLog+'\n'+partyLog,meta,before,after,ledger,client:x,now}).gates.client.status,'BLOCKED');
});
test('persistence export must include the actual two observed pilots',()=>{
 const x=structuredClone(before);x.characters[1].id=999;
 assert.equal(audit({events:worldLog+'\n'+partyLog,meta,before:x,after,ledger,client,now}).gates.persistence.status,'FAIL');
});
test('same account transfer cannot masquerade as balanced payment',()=>{
 const x=structuredClone(ledger);x.entries[1].account='101';
 assert.equal(checkEconomy(x,meta).status,'FAIL');
});
test('zero monetary delta cannot count as settled transaction',()=>{
 const x=structuredClone(ledger);x.entries[0].delta='0';
 assert.equal(checkEconomy(x,meta).status,'FAIL');
});
test('runtime metadata must have a real container start timestamp',()=>{
 const x={...meta};delete x.containerStartedAt;
 assert.equal(audit({events:worldLog,meta:x,now}).overall,'BLOCKED_REVISION');
});

// Native peer-to-peer item and inactive ship ownership is checked from SQLite,
// not from client checkboxes or a server chat/loot event.
test('read-only custody proof sees both a real item and inactive ship move',()=>{
  const result=checkGifts(giftBefore,giftAfter,meta,['101','102']);
  assert.equal(result.status,'PASS_CUSTODY');
  assert.deepEqual(result.movements.map(m=>m.kind).sort(),['item','ship']);
});
test('no native before/after gifting state is BLOCKED even if clients claim gifts',()=>{
  assert.equal(checkGifts(null,null,meta).status,'BLOCKED');
  const report=audit({events:worldLog+'\n'+partyLog,meta,before,after,ledger,client,now});
  assert.equal(report.overall,'BLOCKED');assert.equal(report.gates.gifts.status,'BLOCKED');
});
test('native player-to-player custody cannot invent inventory or ISK',()=>{
  const dup=structuredClone(giftAfter);dup.characters[1].items.push({...dup.characters[1].items[0],id:9909});
  assert.equal(checkGifts(giftBefore,dup,meta).status,'FAIL');
  const isk=structuredClone(giftAfter);isk.characters[0].isk='100001';
  assert.equal(checkGifts(giftBefore,isk,meta).status,'FAIL');
});
test('native custody must not transfer an active player ship or lack the ordinary gift',()=>{
  const active=structuredClone(giftAfter);
  const moved=active.characters[0].items.find(i=>i.id===3001);
  active.characters[0].items=active.characters[0].items.filter(i=>i.id!==3001);
  active.characters[1].items.push(moved);
  assert.equal(checkGifts(giftBefore,active,meta).status,'FAIL');
  const one=structuredClone(giftAfter);
  const gift=one.characters[1].items.find(i=>i.id===4001);
  one.characters[1].items=one.characters[1].items.filter(i=>i.id!==4001);
  one.characters[0].items.push({...gift,locationId:3001});
  assert.equal(checkGifts(giftBefore,one,meta).status,'BLOCKED');
});
test('gift proof cannot join snapshots across server restarts or different accounts',()=>{
  const reboot=structuredClone(giftAfter);reboot.runtime.containerStartedAt='2026-10-25T10:35:00Z';
  assert.equal(checkGifts(giftBefore,reboot,meta).status,'BLOCKED');
  const sameAccount=structuredClone(giftAfter);sameAccount.characters[1].accountId=201;
  assert.equal(checkGifts(giftBefore,sameAccount,meta).status,'FAIL');
});
test('snapshot provenance rejects same-account pilots and missing active ship',()=>{
  const sameAccount=structuredClone(before);sameAccount.characters[1].accountId=201;
  assert.equal(checkPersistence(sameAccount,after,meta).status,'FAIL');
  const noShip=structuredClone(before);noShip.characters[0].items=noShip.characters[0].items.filter(i=>i.id!==3001);
  assert.equal(checkPersistence(noShip,after,meta).status,'FAIL');
});

// Long-uptime regression: reporter needs the process's real boot history,
// but stale movement/cargo must never qualify as current native gameplay.
const eventAt=(kind,ageMinutes,more={})=>event(kind,more,now-ageMinutes*60000);
const oldAnchors=[
 eventAt('living-headless-boot-requested',90),
 eventAt('living-world-topology',89,{realWaypoints:8,realAsteroidBelts:2}),
 eventAt('living-native-industry',89,{fleets:[{minerIDs:[101],haulerIDs:[102]}]}),
 eventAt('virtual-world-materialization',89,{livingShips:[{entityID:103,pilotID:'coop-pilot-003',role:'pirate'}]})
];
test('long-running world retains real pre-window boot/topology while fresh native NPCs pass',()=>{
 const input=[...oldAnchors,eventAt('living-native-activity',2,{status:'SAMPLED',observedMovement:2,oreGrowth:1,physicalNpcShips:3})].join('\n');
 const result=checkWorld(input,meta,now,30);
 assert.equal(result.status,'PASS_SERVER');
 assert.equal(result.freshSamples,1);
});
test('old physical movement and ore cannot pass with unrelated fresh logs',()=>{
 const input=[...oldAnchors,eventAt('living-native-activity',70,{status:'SAMPLED',observedMovement:2,oreGrowth:1,physicalNpcShips:3}),eventAt('living-world-phase-failed',2,{phase:'unrelated'})].join('\n');
 assert.equal(checkWorld(input,meta,now,30).status,'BLOCKED');
});
test('fresh activity from a different solar system is not physical proof for selected topology',()=>{
 const input=[...oldAnchors,eventAt('living-native-activity',70,{status:'SAMPLED',observedMovement:1,oreGrowth:2,physicalNpcShips:3}),eventAt('living-native-activity',2,{systemID:30000144,status:'SAMPLED',observedMovement:2,oreGrowth:2,physicalNpcShips:3})].join('\n');
 assert.equal(checkWorld(input,meta,now,30).status,'BLOCKED');
});
test('missing newly observed movement blocks even with current ore and stock NPC count',()=>{
 const input=[...oldAnchors,eventAt('living-native-activity',70,{status:'SAMPLED',observedMovement:2,oreGrowth:2,physicalNpcShips:3}),eventAt('living-native-activity',2,{status:'SAMPLED',observedMovement:0,oreGrowth:2,physicalNpcShips:3})].join('\n');
 assert.equal(checkWorld(input,meta,now,30).status,'BLOCKED');
});
test('latest boot invalidates movement sampled before a same-process headless reinitialization',()=>{
 const input=[...oldAnchors,eventAt('living-native-activity',10,{status:'SAMPLED',observedMovement:2,oreGrowth:2,physicalNpcShips:3}),eventAt('living-headless-boot-requested',5),eventAt('living-world-phase-failed',1,{phase:'unrelated'})].join('\n');
 assert.equal(checkWorld(input,meta,now,30).status,'BLOCKED');
});
test('PowerShell evidence reader retains real topology, native industry and materialization anchors',()=>{
 const fs=require('node:fs');
 const src=fs.readFileSync(new URL('../scripts/Verify-Coop-Reliability.ps1',import.meta.url),'utf8');
 for(const name of ['living-headless-boot-requested','living-world-topology','living-native-industry','virtual-world-materialization'])
  assert.ok(src.includes(name),`missing real historical anchor ${name}`);
 assert.ok(src.includes('tail -n 10000'), 'bounded recent telemetry tail must be preserved');
 assert.doesNotMatch(src,/docker\s+compose[^\n]*\b(?:restart|up\s+-d|down|build)\b/i);
});
test('two-system world checks native activity against its own system, not newest other-system topology',()=>{
 const anotherSystem=eventAt('living-world-topology',1,{systemID:30000144,realWaypoints:8,realAsteroidBelts:2});
 const input=[...oldAnchors,anotherSystem,eventAt('living-native-activity',2,{status:'SAMPLED',observedMovement:1,oreGrowth:1,physicalNpcShips:3})].join('\n');
 const result=checkWorld(input,meta,now,30);
 assert.equal(result.status,'PASS_SERVER');
 assert.equal(result.systemID,30000142);
});
test('native activity without a matching historical topology remains blocked',()=>{
 const input=[...oldAnchors,eventAt('living-native-activity',1,{systemID:30000144,status:'SAMPLED',observedMovement:1,oreGrowth:1,physicalNpcShips:3})].join('\n');
 assert.equal(checkWorld(input,meta,now,30).status,'BLOCKED');
});