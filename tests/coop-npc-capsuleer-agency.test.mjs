import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {createIntelLedger} = require('../integration/coopNpcIntelLedger.cjs');
const {chooseOpportunity} = require('../integration/coopNpcOpportunityPlanner.cjs');
const {createHuntPolicy} = require('../integration/coopNpcHuntPolicy.cjs');
const SID = 30000144;
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evejs-hunt-'));
  let now = 1000000;
  const file = path.join(dir, 'intel.json');
  const actor = {itemID: 101, nativeNpc: true, kind: 'ship', position: {x: 0,y: 0,z: 0}};
  const prey = {itemID: 201, nativeNpc: true, kind: 'ship', position: {x: 60000,y: 0,z: 0}};
  const patrol = {itemID: 301, nativeNpc: true, kind: 'ship', position: {x: 65000,y: 0,z: 0}};
  const player = {itemID: 401, nativeNpc: false, kind: 'ship', position: {x: 65000,y: 0,z: 0}};
  const entities = new Map([[101,actor],[201,prey],[301,patrol],[401,player]]);
  const sessions = new Map();
  const scene = {systemID: SID, getEntityByID: id => entities.get(id), sessions};
  const input = {systemID: SID, scene, pirateID: 101, piratePilotID: 'coop-pilot-001',
    targetID: 201, targetRole: 'hauler', contacts: [],
    getHealth: () => 1, isScrambled: () => false};
  return {dir,file,scene,actor,prey,patrol,player,sessions,input,
    clock: () => now, advance: ms => {now += ms;},
    cleanup: () => fs.rmSync(dir,{recursive: true, force: true})};
}
test('read-only risk planner chooses meaningful work over guarded NPC convoy', () => {
  const intel = {targetRole:'hauler',confidence:.95,ageMs:1000};
  const p = {intel,targetRole:'hauler',hunterHealth:1,escapeReady:true,distanceMeters:60000};
  assert.equal(chooseOpportunity(p).decision,'RAID');
  assert.equal(chooseOpportunity({...p,escortCount:1}).decision,'WORK');
  assert.equal(chooseOpportunity({...p,playerContacts:2}).decision,'WORK');
  assert.equal(chooseOpportunity({...p,competingJobValue:150}).reason,'BETTER_NONCOMBAT_WORK');
  assert.equal(chooseOpportunity({...p,escapeReady:false}).decision,'RETREAT');
  assert.equal(chooseOpportunity({...p,hunterHealth:0.4}).decision,'RETREAT');
  assert.equal(chooseOpportunity({...p,intel:null}).decision,'SCOUT');
  assert.equal(chooseOpportunity({...p,escortCount:-1}).reason,'UNKNOWN_RISK');
});
test('native NPC visual sighting is durable, scoped and expires; no hidden player intel', () => {
  const f=fixture();
  try {
    const ledger=createIntelLedger({file:f.file,clock:f.clock,ttlMs:90000});
    assert.equal(ledger.observe({pilotID:'coop-pilot-001',targetID:201,systemID:SID,
      targetRole:'hauler',position:f.prey.position,distanceMeters:60000}).status,'OBSERVED');
    assert.ok(createIntelLedger({file:f.file,clock:f.clock}).recall({pilotID:'coop-pilot-001',targetID:201,systemID:SID}));
    assert.equal(ledger.recall({pilotID:'coop-pilot-002',targetID:201,systemID:SID}),null);
    assert.equal(ledger.recall({pilotID:'coop-pilot-001',targetID:201,systemID:30000142}),null);
    assert.equal(ledger.observe({pilotID:'coop-pilot-001',targetID:401,systemID:SID,
      targetRole:'player',position:f.player.position,distanceMeters:100}).status,'INVALID_WITNESS');
    assert.equal(ledger.observe({pilotID:'coop-pilot-001',targetID:202,systemID:SID,
      targetRole:'miner',position:f.prey.position,distanceMeters:300000}).status,'INVALID_WITNESS');
    f.advance(90001);
    assert.equal(ledger.recall({pilotID:'coop-pilot-001',targetID:201,systemID:SID}),null);
  } finally {f.cleanup();}
});
test('real hunter chooses witnessed NPC convoy but declines a genuine nearby patrol', () => {
  const f=fixture();
  try {
    const policy=createHuntPolicy({file:f.file,clock:f.clock});
    assert.equal(policy.assess(f.input).decision,'RAID');
    const guarded=policy.assess({...f.input,contacts:[{entityID:301,role:'patrol'}]});
    assert.equal(guarded.decision,'WORK');
    assert.equal(guarded.reason,'RISK_TOO_HIGH');
    assert.equal(policy.intel.snapshot().sightings['coop-pilot-001:201'].targetRole,'hauler');
  } finally {f.cleanup();}
});
test('two actual players near prey deter raider; never select the humans as prey', () => {
  const f=fixture();
  try {
    f.sessions.set(2,{characterID:2,_space:{shipID:401,systemID:SID,initialStateSent:true}});
    const p=createHuntPolicy({file:f.file,clock:f.clock});
    assert.equal(p.assess(f.input).decision,'WORK');
    assert.equal(p.assess({...f.input,targetID:401,targetRole:'hauler'}).reason,'PHYSICAL_NPC_REQUIRED');
    assert.equal(p.intel.snapshot().sightings['coop-pilot-001:401'],undefined);
    assert.equal(p.assess({...f.input,targetID:201,targetRole:'player'}).reason,'INVALID_NATIVE_CONTEXT');
  } finally {f.cleanup();}
});
test('after fresh sighting NPC may consider a recent escape but not omniscient long-range pursuit', () => {
  const f=fixture();
  try {
    const policy=createHuntPolicy({file:f.file,clock:f.clock});
    assert.equal(policy.assess(f.input).decision,'RAID');
    f.prey.position.x=280000;
    f.advance(10000);
    assert.equal(policy.assess(f.input).decision,'RAID');
    f.prey.position.x=510000;
    assert.equal(policy.assess(f.input).reason,'TARGET_MOVED_BEYOND_INTEL');
    f.prey.position.x=280000;
    f.advance(80001);
    assert.equal(policy.assess(f.input).reason,'NO_FRESH_WITNESS');
  } finally {f.cleanup();}
});
test('native identity, same system, health, scramble and missing telemetry fail closed',()=>{
  const f=fixture();
  try {
    const p=createHuntPolicy({file:f.file,clock:f.clock});
    assert.equal(p.assess({...f.input,systemID:30000142}).reason,'INVALID_NATIVE_CONTEXT');
    assert.equal(p.assess({...f.input,piratePilotID:'guest'}).reason,'INVALID_NATIVE_CONTEXT');
    f.actor.nativeNpc=false;
    assert.equal(p.assess(f.input).reason,'PHYSICAL_NPC_REQUIRED');
    f.actor.nativeNpc=true;
    assert.equal(p.assess({...f.input,getHealth:()=>NaN}).reason,'NATIVE_SAFETY_INPUT_UNAVAILABLE');
    assert.equal(p.assess({...f.input,isScrambled:()=>true}).decision,'RETREAT');
    assert.equal(p.assess({...f.input,getHealth:()=>0.35}).decision,'RETREAT');
    assert.equal(p.assess({...f.input,getHealth:()=>{throw Error('no dogma')}}).reason,'NATIVE_SAFETY_INPUT_UNAVAILABLE');
  } finally {f.cleanup();}
});
test('corrupt intel state blocks startup rather than resetting pilot memories',()=>{
  const f=fixture();
  try {
    fs.writeFileSync(f.file,'{"version":8,"sightings":{}}');
    assert.throws(()=>createHuntPolicy({file:f.file,clock:f.clock}),/INVALID_NPC_INTEL_STATE/);
    assert.match(fs.readFileSync(f.file,'utf8'),/"version":8/);
  } finally {f.cleanup();}
});
test('intel entries are bounded and pruned by TTL; no free attack after restart',()=>{
  const f=fixture();
  try {
    const l=createIntelLedger({file:f.file,clock:f.clock,maxEntries:2});
    for(const id of [201,202,203]){
      l.observe({pilotID:'coop-pilot-001',targetID:id,systemID:SID,
        targetRole:'miner',position:f.prey.position,distanceMeters:100});
      f.advance(16000);
    }
    assert.equal(Object.keys(l.snapshot().sightings).length,2);
    assert.equal(l.recall({pilotID:'coop-pilot-001',targetID:201,systemID:SID}),null);
    f.advance(100000);
    assert.equal(createIntelLedger({file:f.file,clock:f.clock}).recall({
      pilotID:'coop-pilot-001',targetID:203,systemID:SID}),null);
  }finally{f.cleanup();}
});
test('deployed .js overlay resolves the same sibling modules as local .cjs tests',()=>{
  const f=fixture();
  try {
    for(const name of ['coopNpcIntelLedger','coopNpcOpportunityPlanner','coopNpcHuntPolicy']){
      fs.copyFileSync(new URL('../integration/'+name+'.cjs',import.meta.url),
        path.join(f.dir,name+'.js'));
    }
    const deployed=require(path.join(f.dir,'coopNpcHuntPolicy.js'));
    assert.equal(deployed.createHuntPolicy({file:f.file,clock:f.clock}).assess(f.input).decision,'RAID');
  } finally {f.cleanup();}
});
