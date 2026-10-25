import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {audit, checkPersistence, checkEconomy, checkWorld, checkParty, checkClient, parseEvents} = require('../scripts/coop-reliability-gates.cjs');
const now=Date.parse('2026-10-25T11:00:00Z');
const meta={projectSha:'a'.repeat(40),upstreamSha:'b'.repeat(40),imageId:'sha256:'+'c'.repeat(64)};
const event=(event,props={},time=now-10000)=>JSON.stringify({event,at:new Date(time).toISOString(),systemID:30000142,...props});
const worldLog=[event('living-headless-boot-requested'),event('living-world-topology',{realWaypoints:8,realAsteroidBelts:2}),event('living-native-industry',{fleets:[{minerIDs:[101],haulerIDs:[102]}]}),event('virtual-world-materialization',{livingShips:[{entityID:103,pilotID:'coop-pilot-003',role:'pirate'}]}),event('living-native-activity',{status:'SAMPLED',observedMovement:2,oreGrowth:2,physicalNpcShips:3})].join('\n');
const partyLog=[event('space-login-attach',{characterID:1,shipID:101}),event('space-login-attach',{characterID:2,shipID:102}),event('coop-shared-scene',{mutualVisibility:true,pilots:[{characterID:1,shipID:101,shipExists:true},{characterID:2,shipID:102,shipExists:true}]})].join('\n');
function snapshot(at, startedAt,changes={}) {return {
  source:'native-authoritative-export',projectSha:meta.projectSha,upstreamSha:meta.upstreamSha,
  capturedAt:at, runtime:{volumeName:'evejs-data',containerId:'f'.repeat(64),imageId:meta.imageId,containerStartedAt:startedAt},
  characters:[{id:101,shipId:3001,systemId:30000142,isk:'100000',items:[{id:1001,typeId:34,quantity:500,locationId:3001}]},
    {id:102,shipId:3002,systemId:30000142,isk:'200000',items:[{id:1002,typeId:35,quantity:100,locationId:3002}]}],...changes
};}
const before=snapshot('2026-10-25T10:00:00Z','2026-10-25T09:00:00Z');
const after=snapshot('2026-10-25T10:15:00Z','2026-10-25T10:05:00Z');
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
test('two authenticated-looking TCP sockets do not qualify as shared scene',()=>assert.equal(checkParty(event('tcp-reconnected'),now,30).status,'BLOCKED'));
test('recent mutual scene qualifies only server-side, not a real client',()=>assert.equal(checkParty(partyLog,now,30).status,'PASS_SERVER'));
test('stale shared scene is blocked even with two previous pilots',()=>assert.equal(checkParty(partyLog.replaceAll('2026-10-25T10:59:50.000Z','2026-10-25T10:50:00.000Z'),now,30).status,'BLOCKED'));
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
test('complete evidence never reports automated visual proof',()=>{const report=audit({events:worldLog+'\n'+partyLog,meta,before,after,ledger,client,now});assert.equal(report.overall,'PASS_WITH_OPERATOR_ATTESTATION');assert.equal(report.gates.client.status,'PASS_OPERATOR_ATTESTED');});
test('missing any of the five gates keeps overall BLOCKED',()=>{const report=audit({events:worldLog+'\n'+partyLog,meta,before,after,client,now});assert.equal(report.overall,'BLOCKED');assert.equal(report.gates.economy.status,'BLOCKED');});
test('valid event rows are bounded by window and rejects malformed timestamps',()=>{const out=parseEvents(event('x')+'\n'+JSON.stringify({event:'a',at:'bad'}),now,30);assert.equal(out.invalid,1);assert.equal(out.rows.length,1);});

test('duplicate reward key inside one transaction also fails',()=>{const x=structuredClone(ledger);x.entries.push({entryId:'new',txId:'mission7',account:'102',delta:'1000',kind:'mint',rewardKey:'mission:7:character:101'});assert.equal(checkEconomy(x,meta).status,'FAIL');});
test('a mint transaction can contain distinct issuance keys',()=>{const x=structuredClone(ledger);x.entries.push({entryId:'new',txId:'mission7',account:'102',delta:'1000',kind:'mint',rewardKey:'mission:7:character:102'});assert.equal(checkEconomy(x,meta).status,'PASS_LEDGER');});
test('noncanonical duplicate item identifiers are rejected',()=>{const x=structuredClone(after);x.characters[1].items[0].id='01001';assert.equal(checkPersistence(before,x,meta).status,'FAIL');});
test('scene from before new server boot cannot pass party gate',()=>{const input=partyLog+'\n'+event('living-headless-boot-requested',{},now-5000);assert.equal(checkParty(input,now,30).status,'BLOCKED');});
test('missing shared loot or ship gift never qualifies full coop',()=>{const x=structuredClone(client);x.observations.sharedLoot=false;assert.equal(checkClient(x,meta,now).status,'BLOCKED');const y=structuredClone(client);y.observations.shipGift=false;assert.equal(checkClient(y,meta,now).status,'BLOCKED');});