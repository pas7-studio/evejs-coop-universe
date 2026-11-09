'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('./fixture.cjs');
const {open,tempDb,command,OWNER,PILOT,SHIP,ASSIGNMENT,claimsPolicy,pf52}=F;
function withDb(fn,{onboard=true}={}){const temp=tempDb();let f;try{f=open(temp.file);f.seed();if(onboard)f.onboard();return fn(f)}finally{f?.close();temp.cleanup()}}
const deployKey=()=>F.pf54.key(ASSIGNMENT);
const item=f=>f.get('items',String(SHIP));
const roster=f=>f.get('corporationRuntime',pf52.ROSTER_PREFIX+OWNER);
const characters=f=>f.get('characters','characters')[String(OWNER)];
const wallet=f=>f.get('corporationRuntime','corporations\u001f'+F.EMPLOYER).wallet.divisions['1000'];
function ready(f){assert.equal(f.bridge.prepare(command()).status,'PREPARED');}
function issuing(f){ready(f);return f.bridge.dispatch(command())}
function active(f){const out=issuing(f);assert.equal(out.status,'AWAITING_NATIVE_RECONCILIATION');assert.equal(f.bridge.reconcile(command()).status,'ACTIVE')}

test('PF53 paid hire -> PF52 original hangar reservation -> PF54 physical original entity controller claim',()=>withDb(f=>{
 assert.equal(characters(f).balance,3500);assert.equal(wallet(f).balance,2300);
 assert.equal(item(f).flagID,4);ready(f);assert.equal(item(f).flagID,4);
 assert.equal(f.get('corporationRuntime',deployKey()).phase,'PREPARED');
 assert.equal(f.shared.spawnCount,0);
 const res=f.bridge.dispatch(command());assert.equal(res.status,'AWAITING_NATIVE_RECONCILIATION');
 assert.equal(item(f).itemID,SHIP);assert.equal(item(f).flagID,0);assert.equal(item(f).ownerID,OWNER);
 assert.equal(f.shared.scene.entityID,SHIP);assert.equal(f.shared.scene.controllerEntityID,SHIP);
 const a=f.bridge.reconcile(command());assert.equal(a.status,'ACTIVE');
 assert.equal(f.get('corporationRuntime',claimsPolicy.KEY).claims[String(SHIP)].pilotID,PILOT);
 assert.equal(roster(f).pilots[PILOT].shipItemID,SHIP);
 assert.equal(characters(f).balance,3500);assert.equal(wallet(f).balance,2300);
 assert.equal(f.shared.spawnCount,1);
}));
test('preparing a paid original hangar ship never spawns nor moves an item',()=>withDb(f=>{
 ready(f);assert.equal(f.shared.spawnCount,0);assert.equal(item(f).flagID,4);assert.equal(f.get('corporationRuntime',claimsPolicy.KEY),null);
}));
test('duplicate prepare is read-only; duplicate dispatch is blocked even if executor said completed',()=>withDb(f=>{
 ready(f);assert.equal(f.bridge.prepare(command()).status,'DUPLICATE');
 assert.equal(f.bridge.dispatch(command()).status,'AWAITING_NATIVE_RECONCILIATION');
 assert.equal(f.bridge.prepare(command()).phase,'ISSUING');
 assert.equal(f.bridge.dispatch(command()).reason,'PF54_DISPATCH_REQUIRES_RECONCILIATION');
 assert.equal(f.shared.spawnCount,1);
}));
test('different operationID cannot overwrite existing original assignment',()=>withDb(f=>{
 ready(f);assert.equal(f.bridge.prepare(command({operationID:'pf54-other'})).reason,'PF54_ASSIGNMENT_ALREADY_PREPARED');
 assert.equal(f.bridge.dispatch(command({operationID:'pf54-other'})).reason,'PF54_DISPATCH_INTENT_MISSING_OR_FOREIGN');
}));
test('crash after durable ISSUING and before physical handoff never reissues',()=>withDb(f=>{
 ready(f);f.shared.onHandoff=()=>{throw Error('PROCESS_CRASH_AFTER_CLAIM')};
 assert.equal(f.bridge.dispatch(command()).status,'NATIVE_OUTCOME_UNKNOWN');
 assert.equal(f.get('corporationRuntime',deployKey()).dispatchCount,1);
 assert.equal(f.bridge.dispatch(command()).reason,'PF54_DISPATCH_REQUIRES_RECONCILIATION');
 assert.equal(f.shared.spawnCount,1);
 assert.equal(f.bridge.reconcile(command()).reason,'PF54_ORIGINAL_ITEM_NOT_IN_SPACE');
}));
test('reconciliation requires original ItemStore physical relocation, not executor status',()=>withDb(f=>{
 ready(f);f.shared.onHandoff=()=>({status:'COMPLETED'});
 assert.equal(f.bridge.dispatch(command()).status,'AWAITING_NATIVE_RECONCILIATION');
 assert.equal(f.bridge.reconcile(command()).reason,'PF54_ORIGINAL_ITEM_NOT_IN_SPACE');
 assert.equal(f.get('corporationRuntime',deployKey()).phase,'ISSUING');
}));
test('the executor status cannot itself create PF actor claim',()=>withDb(f=>{
 issuing(f);assert.equal(f.get('corporationRuntime',claimsPolicy.KEY),null);
}));
test('reconcile is idempotent and cannot claim another generation',()=>withDb(f=>{
 active(f);assert.equal(f.bridge.reconcile(command()).status,'ALREADY_ACTIVE');
 assert.equal(f.get('corporationRuntime',claimsPolicy.KEY).generations[String(SHIP)],1);
 assert.equal(f.shared.spawnCount,1);
}));
test('if not dispatched, cannot self-activate from a spoofed scene',()=>withDb(f=>{
 ready(f);f.shared.scene={};assert.equal(f.bridge.reconcile(command()).reason,'PF54_NOT_ELIGIBLE_FOR_RECONCILIATION');
}));
test('wrong physical entity ID blocks activation even with correct item',()=>withDb(f=>{
 issuing(f);f.shared.scene.entityID=SHIP+1;
 assert.equal(f.bridge.reconcile(command()).reason,'PF54_ORIGINAL_PHYSICAL_ACTOR_NOT_PROVEN');
 assert.equal(f.get('corporationRuntime',claimsPolicy.KEY),null);
}));
test('wrong original controller ID blocks activation',()=>withDb(f=>{
 issuing(f);f.shared.scene.controllerEntityID=SHIP+1;
 assert.equal(f.bridge.reconcile(command()).reason,'PF54_ORIGINAL_PHYSICAL_ACTOR_NOT_PROVEN');
}));
test('different original itemID cannot pass via scene alone',()=>withDb(f=>{
 issuing(f);f.shared.scene.shipItemID=SHIP+1;
 assert.equal(f.bridge.reconcile(command()).reason,'PF54_ORIGINAL_PHYSICAL_ACTOR_NOT_PROVEN');
}));
test('original actor fitting hash mismatch blocks activation',()=>withDb(f=>{
 issuing(f);f.shared.scene.fittingHash=F.H('new-fit');
 assert.equal(f.bridge.reconcile(command()).reason,'PF54_ORIGINAL_PHYSICAL_ACTOR_NOT_PROVEN');
}));
test('original actor cargo hash mismatch blocks activation',()=>withDb(f=>{
 issuing(f);f.shared.scene.cargoHash=F.H('new-cargo');
 assert.equal(f.bridge.reconcile(command()).reason,'PF54_ORIGINAL_PHYSICAL_ACTOR_NOT_PROVEN');
}));
test('ambiguous multiple native entities are never a proof',()=>withDb(f=>{
 issuing(f);f.shared.scene.noDuplicatePhysicalEntity=false;
 assert.equal(f.bridge.reconcile(command()).reason,'PF54_ORIGINAL_PHYSICAL_ACTOR_NOT_PROVEN');
}));
test('dead native ship is not ACTIVE',()=>withDb(f=>{
 issuing(f);f.shared.scene.alive=false;
 assert.equal(f.bridge.reconcile(command()).reason,'PF54_ORIGINAL_PHYSICAL_ACTOR_NOT_PROVEN');
}));
test('stock ItemStore must contain the exact in-space original hull',()=>withDb(f=>{
 issuing(f);const root=f.get('items',String(SHIP));root.ownerID=123456;f.put('items',String(SHIP),root);
 assert.equal(f.bridge.reconcile(command()).reason,'PF54_ORIGINAL_ITEM_NOT_IN_SPACE');
}));
test('ItemStore without original physical spaceState fails even if actor exists',()=>withDb(f=>{
 issuing(f);const root=f.get('items',String(SHIP));delete root.spaceState;f.put('items',String(SHIP),root);
 assert.equal(f.bridge.reconcile(command()).reason,'PF54_ORIGINAL_ITEM_NOT_IN_SPACE');
}));
test('incorrect target system cannot claim ship',()=>withDb(f=>{
 issuing(f);const root=f.get('items',String(SHIP));root.spaceState.systemID+=1;f.put('items',String(SHIP),root);
 assert.equal(f.bridge.reconcile(command()).reason,'PF54_ORIGINAL_ITEM_NOT_IN_SPACE');
}));
test('corrupted actor registry fails closed before claim write',()=>withDb(f=>{
 issuing(f);f.put('corporationRuntime',claimsPolicy.KEY,{version:2,claims:{},generations:{},processed:{}});
 assert.equal(f.bridge.reconcile(command()).reason,'PF54_RECONCILE_ORIGINAL_ATOMIC_UNCERTAIN');
 assert.equal(f.get('corporationRuntime',deployKey()).phase,'ISSUING');
}));
test('an existing PF actor claim blocks deployment before double ownership',()=>withDb(f=>{
 f.put('corporationRuntime',claimsPolicy.KEY,{version:1,claims:{[SHIP]:{entityID:SHIP,pilotID:'coop-pilot-999',ownerCharacterID:OWNER,ownerType:'PERSONAL_FLEET',generation:1}},generations:{[SHIP]:1},processed:{}});
 assert.equal(f.bridge.prepare(command()).reason,'PF52_ACTIVE_PERSONAL_ACTOR_RESERVED');
}));
test('active WAR ship reservation blocks deployment',()=>withDb(f=>{
 f.put('corporationRuntime','coop-faction-war\u001ffleet-registry-v1',{
 version:1,ships:{[SHIP]:{entityID:SHIP,pilotID:'coop-pilot-999'}},processed:{},history:[]});
 assert.equal(f.bridge.prepare(command()).reason,'PF52_WAR_SHIP_OR_PILOT_RESERVED');
}));
test('WAR transfer reservation blocks deployment',()=>withDb(f=>{
 f.put('corporationRuntime','coop-faction-war\u001ffleet-registry-v1',{
 version:1,ships:{},transfers:{[SHIP]:{entityID:SHIP,pilotID:'coop-pilot-999'}},processed:{},history:[]});
 assert.equal(f.bridge.prepare(command()).reason,'PF52_WAR_SHIP_OR_PILOT_RESERVED');
}));
test('original item switched to another station before dispatch remains PREPARED',()=>withDb(f=>{
 ready(f);const item=f.get('items',String(SHIP));item.locationID=100;f.put('items',String(SHIP),item);
 assert.equal(f.bridge.dispatch(command()).reason,'PF54_HANGAR_CHANGED_BEFORE_DISPATCH');
 assert.equal(f.get('corporationRuntime',deployKey()).phase,'PREPARED');assert.equal(f.shared.spawnCount,0);
}));
test('changed original equipment before dispatch prevents physical handoff',()=>withDb(f=>{
 ready(f);f.shared.fittingHash=F.H('changed');
 assert.equal(f.bridge.dispatch(command()).reason,'PF54_FITTING_OR_CARGO_CHANGED');
 assert.equal(f.shared.spawnCount,0);
}));
test('changed cargo before dispatch prevents physical handoff',()=>withDb(f=>{
 ready(f);f.shared.cargoHash=F.H('changed');
 assert.equal(f.bridge.dispatch(command()).reason,'PF54_FITTING_OR_CARGO_CHANGED');
}));
test('revoked original deploy authority before dispatch blocks native call',()=>withDb(f=>{
 ready(f);f.shared.authority=false;
 assert.equal(f.bridge.dispatch(command()).reason,'PF54_DEPLOYMENT_AUTHORITY_REVOKED');
 assert.equal(f.shared.spawnCount,0);
}));
test('revoked authentic session before prepare blocks',()=>withDb(f=>{
 f.shared.auth=false;assert.equal(f.bridge.prepare(command()).reason,'PF54_ACCESS_DENIED');
 assert.equal(f.get('corporationRuntime',deployKey()),null);
}));
test('revoked session after prepare blocks dispatch',()=>withDb(f=>{
 ready(f);f.shared.auth=false;assert.equal(f.bridge.dispatch(command()).reason,'PF54_ACCESS_DENIED');
 assert.equal(f.shared.spawnCount,0);
}));
test('revoked writers after prepare blocks dispatch',()=>withDb(f=>{
 ready(f);f.shared.writers=false;assert.equal(f.bridge.dispatch(command()).reason,'PF54_GLOBAL_WRITERS_NOT_FENCED');
 assert.equal(f.shared.spawnCount,0);
}));
test('revoked writers inside transaction blocks even a valid preflight',()=>withDb(f=>{
 f.shared.onTx=()=>{f.shared.writers=false};
 assert.equal(f.bridge.prepare(command()).reason,'PF54_GATE_REVOKED');
 assert.equal(f.get('corporationRuntime',deployKey()),null);
}));
test('revoked auth inside transaction blocks durable intent',()=>withDb(f=>{
 f.shared.onTx=()=>{f.shared.auth=false};
 assert.equal(f.bridge.prepare(command()).reason,'PF54_ACCESS_REVOKED');
 assert.equal(f.get('corporationRuntime',deployKey()),null);
}));
test('global writer gate OFF makes PF54 explicitly inert',()=>withDb(f=>{
 f.shared.writers=false;assert.equal(f.bridge.prepare(command()).reason,'PF54_GLOBAL_WRITERS_NOT_FENCED');
}));
test('feature OFF makes all PF54 entrypoints inert',()=>withDb(f=>{
 f.shared.enabled=false;assert.equal(f.bridge.prepare(command()).status,'DISABLED');
 assert.equal(f.bridge.dispatch(command()).status,'DISABLED');
 assert.equal(f.bridge.reconcile(command()).status,'DISABLED');
}));
test('invalid original paid hiring prevents deployment preparation',()=>withDb(f=>{
 assert.equal(f.bridge.prepare(command()).reason,'PF54_PREPARE_ORIGINAL_ATOMIC_UNCERTAIN');
},{onboard:false}));
test('stale owner roster revision cannot prepare',()=>withDb(f=>{
 assert.equal(f.bridge.prepare(command({expectedRosterRevision:1})).reason,'PF54_ROSTER_REVISION_STALE');
}));
test('stale pilot revision cannot prepare',()=>withDb(f=>{
 assert.equal(f.bridge.prepare(command({expectedPilotRevision:0})).reason,'PF54_ROSTER_REVISION_STALE');
}));
test('wrong owner cannot take ship',()=>withDb(f=>{
 assert.equal(f.bridge.prepare(command({ownerCharacterID:3})).reason,'PF54_COMMAND_INVALID');
}));
test('an untrusted plain NPC call cannot create original physical claim',()=>withDb(f=>{
 f.shared.authority=false;assert.equal(f.bridge.prepare(command()).reason,'PF54_NATIVE_DEPLOYMENT_AUTHORITY_UNVERIFIED');
}));
test('uncertain original equipment blocks PREPARED',()=>withDb(f=>{
 f.shared.fittingHash='bad';assert.equal(f.bridge.prepare(command()).reason,'PF54_ORIGINAL_EQUIPMENT_UNVERIFIED');
}));
test('missing original GameStore transaction bridge constructor fails',()=>{
 assert.throws(()=>F.pf54.createOriginalDeploymentBridge({}),/PF54_AUTHORITATIVE_DEPENDENCIES_REQUIRED/);
});
test('reconcile actor claim and ACTIVE receipt roll back if any SQL put fails',()=>withDb(f=>{
 issuing(f);f.shared.failAfterPut=1;
 assert.equal(f.bridge.reconcile(command()).reason,'PF54_RECONCILE_ORIGINAL_ATOMIC_UNCERTAIN');
 assert.equal(f.get('corporationRuntime',claimsPolicy.KEY),null);
 assert.equal(f.get('corporationRuntime',deployKey()).phase,'ISSUING');
}));
test('a successful ACTIVE receipt is durable even if next inspection cannot read',()=>withDb(f=>{
 active(f);f.shared.onTx=()=>{f.shared.writers=false};
 assert.equal(f.bridge.inspect(command()).reason,'PF54_GATE_REVOKED');
 assert.equal(f.get('corporationRuntime',deployKey()).phase,'ACTIVE');
}));

test('revoked native Mining/PF44 exclusivity blocks prepare',()=>withDb(f=>{
 f.shared.exclusive=false;assert.equal(f.bridge.prepare(command()).reason,
  'PF54_MINING_WAR_EXPLORATION_OWNERSHIP_UNVERIFIED');
}));
test('revoked native Mining/PF44 exclusivity before dispatch keeps original item in hangar',()=>withDb(f=>{
 ready(f);f.shared.exclusive=false;assert.equal(f.bridge.dispatch(command()).reason,
  'PF54_MINING_WAR_EXPLORATION_OWNERSHIP_UNVERIFIED');
 assert.equal(item(f).flagID,4);assert.equal(f.shared.spawnCount,0);
}));
test('revoked native Mining/PF44 exclusivity before reconciliation prevents PF actor claim',()=>withDb(f=>{
 issuing(f);f.shared.exclusive=false;assert.equal(f.bridge.reconcile(command()).reason,
  'PF54_MINING_WAR_EXPLORATION_OWNERSHIP_UNVERIFIED');
 assert.equal(f.get('corporationRuntime',claimsPolicy.KEY),null);
}));
test('an asynchronous original handoff remains durable ISSUING and is never retried',()=>withDb(f=>{
 ready(f);f.shared.onHandoff=()=>Promise.resolve({status:'COMPLETED'});
 const out=f.bridge.dispatch(command());assert.equal(out.status,'NATIVE_OUTCOME_UNKNOWN');
 assert.equal(out.reason,'PF54_ASYNC_HANDOFF_FORBIDDEN');
 assert.equal(f.get('corporationRuntime',deployKey()).phase,'ISSUING');
 assert.equal(f.bridge.dispatch(command()).reason,'PF54_DISPATCH_REQUIRES_RECONCILIATION');
}));