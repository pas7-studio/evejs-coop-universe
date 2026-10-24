import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {connectedGates,createGateTravel}=require("../integration/coopNpcGateTravel.cjs");
const A=30000142,B=30000144;
function fixture(){
 let now=1000000;
 const sourceGate={itemID:900,solarSystemID:A,destinationID:901,destinationSolarSystemID:B};
 const destinationGate={itemID:901,solarSystemID:B,destinationID:900,destinationSolarSystemID:A};
 const gate={kind:"stargate",itemID:900,position:{x:500000,y:0,z:0}};
 const ship={kind:"ship",nativeNpc:true,itemID:100,position:{x:0,y:0,z:0},mode:"STOP"};
 const entities=new Map([[900,gate],[100,ship]]);
 const scene={systemID:A,staticEntities:[gate],getEntityByID:id=>entities.get(id)};
 const links=[{pilotID:"coop-pilot-005",entityID:100,systemID:A,role:"trader"}];
 const gates=new Map([[900,sourceGate],[901,destinationGate]]);
 const requests=[];
 const warp=(id,targetID,opts)=>{requests.push({id,targetID,opts});return {success:true}};
 const controller={entityID:100,systemID:A,manualOrder:null,currentTargetID:0,lastAggressorID:0};
 const travel=createGateTravel({warp,getGate:id=>gates.get(id),clock:()=>now,dwellMs:30000});
 const tick=()=>travel.tick({systemID:A,scene,assignments:links,route:[A,B],
  roles:{"coop-pilot-005":{role:"trader"}},getController:()=>controller});
 return {sourceGate,destinationGate,gates,gate,ship,scene,links,requests,controller,
  travel,tick,advance:ms=>now+=ms};
}
test("a reciprocal real stargate from source scene is required",()=>{
 const x=fixture();
 assert.equal(connectedGates({sourceSystemID:A,targetSystemID:B,
  sourceScene:x.scene,getGate:id=>x.gates.get(id)}).length,1);
 x.destinationGate.destinationID=999;
 assert.equal(connectedGates({sourceSystemID:A,targetSystemID:B,
  sourceScene:x.scene,getGate:id=>x.gates.get(id)}).length,0);
 x.destinationGate.destinationID=900;x.sourceGate.solarSystemID=222;
 assert.equal(connectedGates({sourceSystemID:A,targetSystemID:B,
  sourceScene:x.scene,getGate:id=>x.gates.get(id)}).length,0);
});
test("real NPC warp-to-stargate uses EveJS native warp call and does not change its system",()=>{
 const x=fixture();
 const r=x.tick();
 assert.equal(r.status,"OK");
 assert.deepEqual(r.orders.map(x=>x.action),["NATIVE_WARP_TO_REAL_GATE"]);
 assert.equal(x.requests[0].id,100);assert.equal(x.requests[0].targetID,900);
 assert.equal(x.links[0].systemID,A);
 assert.equal(x.ship.position.x,0);
 assert.deepEqual([...x.travel.activeIDs()],[100]);
});
test("arriving at a real gate without native transfer never claims a system jump",()=>{
 const x=fixture();x.tick();
 x.ship.position.x=500000;x.advance(30000);
 const r=x.tick();assert.equal(r.orders.length,0);
 assert.equal(r.observations[0].status,"AT_REAL_GATE");
 assert.equal(x.travel.snapshot()[0].phase,"AWAITING_NATIVE_TRANSFER");
 assert.equal(x.links[0].systemID,A);
});
test("active combat controller, player ship and fake NPC are not sent to a stargate",()=>{
 const x=fixture();x.controller.currentTargetID=200;
 assert.equal(x.tick().orders.length,0);
 x.controller.currentTargetID=0;x.ship.session={characterID:23};
 assert.equal(x.tick().orders.length,0);
 x.ship.session=null;x.ship.nativeNpc=false;
 assert.equal(x.tick().orders.length,0);
});
test("a ship 5km beyond the physical stargate surface cannot be declared arrived",()=>{
 const x=fixture();x.ship.position.x=505000;
 const r=x.tick();assert.equal(r.observations.length,0);
 assert.equal(r.orders[0].action,"NATIVE_WARP_TO_REAL_GATE");
});
test("a ship within native 2.5km stargate surface range may arrive without changing systems",()=>{
 const x=fixture();x.gate.radius=9000;x.ship.position.x=510000;
 const r=x.tick();assert.equal(r.observations[0].status,"AT_REAL_GATE");
 assert.equal(x.links[0].systemID,A);
});
test("a wrong gate destination or unlinked target blocks physical travel",()=>{
 const x=fixture();x.sourceGate.destinationID=123;
 const result=x.tick();
 assert.equal(result.status,"NO_RECIPROCAL_NATIVE_GATE");
 assert.equal(x.requests.length,0);
});
test("no fake transfer may be certified by an unverified callback",()=>{
 const x=fixture();x.ship.position.x=500000;
 const fake=createGateTravel({clock:()=>1000,
  warp:()=>({success:true}),getGate:id=>x.gates.get(id),
  transfer:()=>({success:true,entityID:100,systemID:B})});
 const r=fake.tick({systemID:A,scene:x.scene,assignments:x.links,
  route:[A,B],roles:{"coop-pilot-005":{role:"trader"}},getController:()=>x.controller});
 assert.equal(r.orders.length,0);
 assert.equal(fake.snapshot()[0].phase,"TRANSFER_NOT_VERIFIED");
});
test("source and destination scene verification is mandatory for opt-in transfer adapter",()=>{
 const x=fixture();x.ship.position.x=500000;
 const verified=createGateTravel({clock:()=>1000,
  warp:()=>({success:true}),getGate:id=>x.gates.get(id),
  transfer:()=>({success:true,entityID:100,systemID:B,
   verifiedSourceAbsent:true,verifiedDestinationPresent:true})});
 const r=verified.tick({systemID:A,scene:x.scene,assignments:x.links,
  route:[A,B],roles:{"coop-pilot-005":{role:"trader"}},getController:()=>x.controller});
 assert.equal(r.orders[0].action,"VERIFIED_NATIVE_GATE_TRANSFER");
 assert.equal(verified.snapshot().length,0);
});
