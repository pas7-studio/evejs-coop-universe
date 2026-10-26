import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createExpeditionDirector}=require("../integration/coopNpcExpeditionDirector.cjs");
function fixture(){
 let now=1000000,commands=[],leases=new Set();
 let sites=[{siteID:440,solarSystemID:30000142,siteKind:"signature",
  targetID:"XYZ-440",family:"relic",instanceID:900,actualPosition:{x:0,y:0,z:0}}];
 const ships=new Map([
 [21,{kind:"ship",nativeNpc:true,itemID:21,corporationID:700,systemID:30000142,position:{x:10000,y:0,z:0}}],
 [23,{kind:"ship",nativeNpc:true,itemID:23,corporationID:700,systemID:30000142,position:{x:1000000,y:0,z:0}}],
 [24,{kind:"ship",nativeNpc:true,itemID:24,corporationID:701,systemID:30000142,position:{x:1100000,y:0,z:0}}]]);
 const native=new Map([[21,{entityID:21,systemID:30000142,corporationID:700}],
 [23,{entityID:23,systemID:30000142,corporationID:700}],
 [24,{entityID:24,systemID:30000142,corporationID:701}]]);
 const controllers=new Map([...ships.keys()].map(id=>[id,{entityID:id,systemID:30000142}]));
 const assignments=[{pilotID:"coop-pilot-021",entityID:21,systemID:30000142},
 {pilotID:"coop-pilot-023",entityID:23,systemID:30000142},
 {pilotID:"coop-pilot-024",entityID:24,systemID:30000142}];
 const roles={"coop-pilot-021":"patrol","coop-pilot-023":"patrol","coop-pilot-024":"patrol"};
 const siteEntity={itemID:440,kind:"signature",position:{x:0,y:0,z:0}};
 const scene={systemID:30000142,getEntityByID:id=>id===440?siteEntity:ships.get(id),
  sessions:new Map()};
 const orderBridge={blocked:({entityID})=>leases.has(entityID),
  issue:({entityID,systemID,owner,action,execute})=>{
   commands.push({entityID,systemID,owner,action});return execute();
  }};
 const create=(config={})=>createExpeditionDirector({clock:()=>now,
  listNativeSites:()=>sites,getNativeEntity:id=>native.get(id),
  getController:id=>controllers.get(id),orderBridge,
  warpToPoint:(id,point)=>{commands.push({id,point});return {success:true}},...config});
 const input=()=>({scene,assignments,roles});
 return {create,input,ships,native,controllers,assignments,roles,commands,leases,siteEntity,
  site:()=>sites[0],setSites:x=>{sites=x},advance:ms=>{now+=ms}};
}
test("on-grid scout dispatches same-corp patrol through native order bridge",()=>{
 const f=fixture(),r=f.create().tick(f.input());
 assert.equal(r.status,"NATIVE_EXPEDITION_TICK");assert.equal(r.observed,1);
 assert.equal(r.orders,1);assert.equal(f.commands[0].owner,"EXPEDITION");
 assert.equal(f.commands[0].entityID,23);assert.equal(f.commands[1].id,23);
 assert.deepEqual(f.commands[1].point,{x:0,y:0,z:0});
 assert.equal(r.nativeLootGranted,false);assert.equal(r.nativeWalletMutation,false);
});
test("repeated world ticks cannot blindly reissue accepted physical warp",()=>{
 const f=fixture(),d=f.create();d.tick(f.input());
 assert.equal(d.tick(f.input()).orders,0);assert.equal(f.commands.length,2);
});
test("different-corp patrol cannot receive privileged scan coordinates",()=>{
 const f=fixture();f.native.get(23).corporationID=701;f.ships.get(23).corporationID=701;
 assert.equal(f.create().tick(f.input()).orders,0);assert.equal(f.commands.length,0);
});
test("no physically present scout means no discovery or warp",()=>{
 const f=fixture();f.ships.get(21).position.x=5000000;
 const r=f.create().tick(f.input());assert.equal(r.observed,0);
 assert.equal(r.orders,0);assert.equal(f.commands.length,0);
});
test("missing controller or corporation fails closed",()=>{
 const f=fixture();f.controllers.delete(21);
 assert.equal(f.create().tick(f.input()).orders,0);
 const g=fixture();g.native.get(21).corporationID=0;
 assert.equal(g.create().tick(g.input()).orders,0);
});
test("active order lease blocks expedition instead of preempting patrol",()=>{
 const f=fixture();f.leases.add(23);
 const r=f.create().tick(f.input());assert.equal(r.orders,0);
 assert.equal(f.commands.length,0);assert.ok(r.blocked>=1);
});
test("site reused at different coordinates invalidates old rendezvous",()=>{
 const f=fixture(),d=f.create();f.leases.add(23);d.tick(f.input());
 f.ships.get(21).position.x=5e7;f.site().actualPosition.x=8e7;f.siteEntity.position.x=8e7;
 f.leases.delete(23);const r=d.tick(f.input());
 assert.equal(r.orders,0);assert.equal(f.commands.length,0);
});
test("catalog failure never guesses positions",()=>{
 const f=fixture();f.setSites(null);
 assert.equal(f.create().tick(f.input()).status,"NATIVE_SITE_CATALOG_INVALID");
});
test("native warp rejection is not a successful expedition",()=>{
 const f=fixture(),d=f.create({warpToPoint:()=>({success:false})});
 assert.equal(d.tick(f.input()).orders,0);assert.equal(d.snapshot().pending,0);
});
test("no independent scheduler exists; effects require explicit tick",()=>{
 const f=fixture(),d=f.create();assert.equal(f.commands.length,0);
 assert.equal(d.snapshot().tips.length,0);assert.equal(d.tick(f.input()).orders,1);
});
test("duplicate native pilot identity denies survey and escort",()=>{
 const f=fixture();f.assignments.push({pilotID:"coop-pilot-021",entityID:23,systemID:30000142});
 const r=f.create().tick(f.input());assert.equal(r.observed,0);assert.equal(r.orders,0);
});
test("oversized catalog cannot exhaust NPC tick",()=>{
 const f=fixture();f.setSites(Array.from({length:2050},(_,i)=>({...f.site(),siteID:i+1})));
 assert.equal(f.create().tick(f.input()).status,"NATIVE_SITE_CATALOG_INVALID");
});

test("catalog-only phantom site cannot grant NPC expedition intel",()=>{
 const f=fixture();f.siteEntity.itemID=900;
 const r=f.create().tick(f.input());assert.equal(r.orders,0);assert.equal(r.observed,0);
});
test("catalog position divergent from physical site entity fails closed",()=>{
 const f=fixture();f.siteEntity.position.x=30000;
 const r=f.create().tick(f.input());assert.equal(r.orders,0);assert.equal(r.observed,0);
});

test("real player on grid becomes rival without receiving corporate intel",()=>{
 const f=fixture();
 f.ships.set(88,{kind:"ship",itemID:88,nativeNpc:false,systemID:30000142,
  position:{x:1000,y:0,z:0}});
 const input=f.input();
 input.scene.sessions=new Map([["p",{characterID:800,
  _space:{shipID:88,systemID:30000142,initialStateSent:true},
  socket:{destroyed:false}}]]);
 const r=f.create().tick(input);
 assert.equal(r.observedPlayers,1);
 assert.ok(r.contested>=1);
 assert.equal(r.orders,1);
 assert.equal(f.commands[0].entityID,23);
});
test("fake player session with no original ship cannot observe a native site",()=>{
 const f=fixture(),input=f.input();
 input.scene.sessions=new Map([["p",{characterID:800,
  _space:{shipID:88,systemID:30000142,initialStateSent:true}}]]);
 assert.equal(f.create().tick(input).observedPlayers,0);
});

test("EX-03B11 source-scanned scout warps first; patrols wait for physical scout arrival",()=>{
 const f=fixture();
 f.site().actualPosition.x=1e9;
 f.siteEntity.itemID=888; // remote signatures need not be on scout grid
 const site=f.site();
 const proof={source:"ORIGINAL_PHYSICAL_NPC_PROBE_SCAN",
   nativeScanCertainty:1,originalProbeCount:4,
   systemID:30000142,scoutEntityID:21,pilotID:"coop-pilot-021",
   corporationID:700,siteID:site.siteID,targetID:site.targetID,
   actualPosition:{...site.actualPosition},
   siteFingerprint:JSON.stringify([site.siteID,site.targetID,site.siteKind,
    site.family,site.typeID??null,site.instanceID??null,site.pairID??null,
    site.actualPosition.x,site.actualPosition.y,site.actualPosition.z])};
 const d=f.create({isNativeProbeScout:id=>id===21,
  nativeProbeScan:({entityID})=>({status:"NATIVE_PROBE_SCANNED",
   proofs:entityID===21?[proof]:[]})});
 const result=d.tick(f.input());
 assert.equal(result.remoteScans,1);
 assert.equal(result.orders,1);
 assert.equal(f.commands[0].owner,"EXPEDITION");
 assert.equal(f.commands[0].entityID,21,"scanner scout must get the FIRST warp");
 assert.equal(result.scoutWarpOrders,1);
 assert.equal(result.patrolWarpOrders,0);
 assert.equal(f.commands[0].action,"expedition-scout-rendezvous");
 assert.deepEqual(f.commands[1].point,site.actualPosition);
 assert.equal(d.tick(f.input()).orders,0,"no duplicate scout warp or premature patrol warp");
 assert.equal(f.commands.length,2);
 f.ships.get(21).position={...site.actualPosition};
 assert.equal(d.tick(f.input()).orders,0,"same-location claim without physical site is not proof");
 assert.equal(f.commands.length,2);
 f.siteEntity.itemID=site.siteID;
 f.siteEntity.position={...site.actualPosition};
 const arrived=d.tick(f.input());
 assert.equal(arrived.orders,1);
 assert.equal(arrived.scoutOnGridVerified,1);
 assert.equal(arrived.scoutWarpOrders,0);
 assert.equal(arrived.patrolWarpOrders,1);
 assert.equal(f.commands[2].entityID,23,"same-corp patrol follows witnessed scout");
 assert.equal(f.commands[2].action,"expedition-rendezvous");
 assert.deepEqual(f.commands[3].point,site.actualPosition);
 assert.equal(d.tick(f.input()).orders,0,"rendezvous cannot replay");
});
test("EX-03B rejects invented perfect probe proof even if catalog contains site",()=>{
 const f=fixture();f.site().actualPosition.x=1e9;f.siteEntity.itemID=999;
 const invalid={source:"ORIGINAL_PHYSICAL_NPC_PROBE_SCAN",
  nativeScanCertainty:1,originalProbeCount:4,systemID:30000142,
  scoutEntityID:21,pilotID:"coop-pilot-021",corporationID:700,
  siteID:f.site().siteID,targetID:f.site().targetID,
  actualPosition:{...f.site().actualPosition},siteFingerprint:"WRONG"};
 const d=f.create({isNativeProbeScout:id=>id===21,
  nativeProbeScan:()=>({status:"NATIVE_PROBE_SCANNED",proofs:[invalid]})});
 assert.equal(d.tick(f.input()).remoteScans,0);
 assert.equal(f.commands.length,0);
});
test("EX-03B cross-corporation native proof cannot issue another corp warp",()=>{
 const f=fixture();f.site().actualPosition.x=1e9;f.siteEntity.itemID=999;
 const s=f.site();
 const proof={source:"ORIGINAL_PHYSICAL_NPC_PROBE_SCAN",
  nativeScanCertainty:1,originalProbeCount:4,systemID:30000142,
  scoutEntityID:21,pilotID:"coop-pilot-021",corporationID:701,
  siteID:s.siteID,targetID:s.targetID,actualPosition:{...s.actualPosition},
  siteFingerprint:JSON.stringify([s.siteID,s.targetID,s.siteKind,
   s.family,s.typeID??null,s.instanceID??null,s.pairID??null,
   s.actualPosition.x,s.actualPosition.y,s.actualPosition.z])};
 const d=f.create({isNativeProbeScout:id=>id===21,
  nativeProbeScan:()=>({status:"NATIVE_PROBE_SCANNED",proofs:[proof]})});
 const r=d.tick(f.input());assert.equal(r.remoteScans,0);assert.equal(r.orders,0);
});

test("real scanner scheduler skips un-equipped early patrol and selects native scout",()=>{
 const f=fixture(),scanned=[];
 const d=f.create({
  isNativeProbeScout:id=>id===23,
  nativeProbeScan:({entityID})=>{
   scanned.push(entityID);
   return {status:"NATIVE_PROBE_SCANNED",proofs:[]};
  }
 });
 d.tick(f.input());
 assert.deepEqual(scanned,[23]);
});
test("original scanner scheduling is bounded to two fitted native patrols",()=>{
 const f=fixture(),scanned=[];
 const d=f.create({
  isNativeProbeScout:()=>true,
  nativeProbeScan:({entityID})=>{
   scanned.push(entityID);
   return {status:"NATIVE_PROBE_SCANNED",proofs:[]};
  }
 });
 d.tick(f.input());
 assert.deepEqual(scanned,[21,23]);
});
test("broken native scanner equipment lookup fails closed per hull",()=>{
 const f=fixture(),scanned=[];
 const d=f.create({
  isNativeProbeScout:id=>{if(id===21)throw Error("Native store unavailable");return id===24;},
  nativeProbeScan:({entityID})=>{
   scanned.push(entityID);
   return {status:"NATIVE_PROBE_SCANNED",proofs:[]};
  }
 });
 d.tick(f.input());
 assert.deepEqual(scanned,[24]);
});

test("long miner and hauler assignment prefix cannot starve real NPC scout",()=>{
 const f=fixture(),seen=[];
 const fillers=Array.from({length:40},(_,i)=>({
  pilotID:"coop-pilot-"+String(i+1000),entityID:1000+i,systemID:30000142
 }));
 for(const assignment of fillers)f.roles[assignment.pilotID]="miner";
 f.assignments.unshift(...fillers);
 const d=f.create({
  isNativeProbeScout:id=>id===23,
  nativeProbeScan:({entityID})=>{
   seen.push(entityID);
   return {status:"NATIVE_PROBE_SCANNED",proofs:[]};
  }
 });
 d.tick(f.input());
 assert.deepEqual(seen,[23]);
});

test("EX-03B10 native scanner authority is mandatory, not an optional fallback",()=>{
 const f=fixture(),scanned=[];
 const d=f.create({nativeProbeScan:({entityID})=>{
  scanned.push(entityID);
  return {status:"NATIVE_PROBE_SCANNED",proofs:[]};
 }});
 const r=d.tick(f.input());
 assert.equal(r.status,"NATIVE_EXPEDITION_TICK");
 assert.deepEqual(scanned,[]);
});

test("EX-03B10 43 ordinary patrols cannot starve fitted scout beyond tiny pilot cap",()=>{
 const f=fixture(),scanned=[];
 for(let i=0;i<40;i++){
  const id=1000+i,pilotID="coop-pilot-"+id;
  f.assignments.push({pilotID,entityID:id,systemID:30000142});
  f.roles[pilotID]="patrol";
 }
 const scoutID=5000,pilotID="coop-pilot-5000";
 f.assignments.push({pilotID,entityID:scoutID,systemID:30000142});
 f.roles[pilotID]="patrol";
 f.native.set(scoutID,{entityID:scoutID,systemID:30000142,corporationID:700});
 f.controllers.set(scoutID,{entityID:scoutID,systemID:30000142});
 f.ships.set(scoutID,{kind:"ship",nativeNpc:true,itemID:scoutID,
  corporationID:700,systemID:30000142,position:{x:1e7,y:0,z:0}});
 const d=f.create({maxPilotsPerTick:2,
  isNativeProbeScout:id=>id===scoutID,
  nativeProbeScan:({entityID})=>{
   scanned.push(entityID);
   return {status:"NATIVE_PROBE_SCANNED",proofs:[]};
  }});
 d.tick(f.input());
 assert.deepEqual(scanned,[scoutID]);
});

test("EX-03B10 rotating bounded scanner preflight eventually visits late scouts",()=>{
 const f=fixture(),scanned=[],checks=[];
 for(let i=0;i<140;i++){
  const id=1000+i,pilotID="coop-pilot-"+id;
  f.assignments.push({pilotID,entityID:id,systemID:30000142});
  f.roles[pilotID]="patrol";
 }
 const scoutID=5000,pilotID="coop-pilot-5000";
 f.assignments.push({pilotID,entityID:scoutID,systemID:30000142});
 f.roles[pilotID]="patrol";
 f.native.set(scoutID,{entityID:scoutID,systemID:30000142,corporationID:700});
 f.controllers.set(scoutID,{entityID:scoutID,systemID:30000142});
 f.ships.set(scoutID,{kind:"ship",nativeNpc:true,itemID:scoutID,
  corporationID:700,systemID:30000142,position:{x:1e7,y:0,z:0}});
 const d=f.create({maxPilotsPerTick:2,
  isNativeProbeScout:id=>{checks.push(id);return id===scoutID;},
  nativeProbeScan:({entityID})=>{
   scanned.push(entityID);
   return {status:"NATIVE_PROBE_SCANNED",proofs:[]};
  }});
 d.tick(f.input());
 assert.deepEqual(scanned,[]);
 assert.equal(checks.length,128,"bounded native hardware checks per tick");
 checks.length=0;
 d.tick(f.input());
 assert.deepEqual(scanned,[scoutID]);
 assert.equal(checks.length,128,"second bounded window wraps safely");
});

test("EX-03B11 remote scan cannot warp a scout with stale native controller",()=>{
 const f=fixture();
 f.site().actualPosition.x=1e9;f.siteEntity.itemID=999;
 const site=f.site(),proof={source:"ORIGINAL_PHYSICAL_NPC_PROBE_SCAN",
  nativeScanCertainty:1,originalProbeCount:4,
  systemID:30000142,scoutEntityID:21,pilotID:"coop-pilot-021",
  corporationID:700,siteID:site.siteID,targetID:site.targetID,
  actualPosition:{...site.actualPosition},
  siteFingerprint:JSON.stringify([site.siteID,site.targetID,site.siteKind,
   site.family,site.typeID??null,site.instanceID??null,site.pairID??null,
   site.actualPosition.x,site.actualPosition.y,site.actualPosition.z])};
 let admitted=false;
 const originalIssue=f.create;
 const d=originalIssue({isNativeProbeScout:id=>id===21,
  nativeProbeScan:()=>({status:"NATIVE_PROBE_SCANNED",proofs:[proof]}),
  orderBridge:{
   blocked:()=>false,
   issue:({execute})=>{f.controllers.delete(21);admitted=true;return execute();}
  }});
 const r=d.tick(f.input());
 assert.equal(admitted,true,"rendezvous went through the original order arbiter");
 assert.equal(r.orders,0,"losing native controller before execution blocks warp");
 assert.equal(d.snapshot().pending,0);
 assert.equal(f.commands.length,0);
});
