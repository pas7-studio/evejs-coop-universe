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
 const scene={systemID:30000142,getEntityByID:id=>ships.get(id),sessions:new Map()};
 const orderBridge={blocked:({entityID})=>leases.has(entityID),
  issue:({entityID,systemID,owner,action,execute})=>{
   commands.push({entityID,systemID,owner,action});return execute();
  }};
 const create=(config={})=>createExpeditionDirector({clock:()=>now,
  listNativeSites:()=>sites,getNativeEntity:id=>native.get(id),
  getController:id=>controllers.get(id),orderBridge,
  warpToPoint:(id,point)=>{commands.push({id,point});return {success:true}},...config});
 const input=()=>({scene,assignments,roles});
 return {create,input,ships,native,controllers,assignments,roles,commands,leases,
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
 f.ships.get(21).position.x=5e7;f.site().actualPosition.x=8e7;
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
