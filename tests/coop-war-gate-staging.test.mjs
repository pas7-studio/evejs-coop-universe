import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWarGateStaging,gate,gateReason}=require("../integration/coopWarGateStaging.cjs");
const flags=()=>({
 EVEJS_COOP_FACTION_WAR:"1",EVEJS_COOP_FACTION_WAR_FLEETS:"1",
 EVEJS_COOP_WAR_TREASURY:"1",EVEJS_COOP_FACTION_WAR_GATE_APPROACH:"1",
 EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1",EVEJS_COOP_ALIFE:"1"
});
function fixture(){
 let now=100000,issued=0,busy=false;
 const env=flags();
 const ship={itemID:501,kind:"ship",nativeNpc:true,
  position:{x:0,y:0,z:0},radius:0};
 const scene={systemID:101,staticEntities:[{
  itemID:801,kind:"stargate",position:{x:1000000,y:0,z:0},radius:0
 }],getEntityByID:id=>id===501?ship:null};
 const gates={801:{itemID:801,solarSystemID:101,
  destinationID:802,destinationSolarSystemID:202},
  802:{itemID:802,solarSystemID:202,destinationID:801}};
 const war={version:1,wars:{w1:{state:"ACTIVE",attackerFactionID:11}},
  campaigns:{c1:{campaignID:"c1",warID:"w1",state:"PREPARING",
   sourceSystemID:101,targetSystemID:202,supplyReservationID:"s1"}}};
 const fleet={version:1,ships:{501:{entityID:501,systemID:101,
  pilotID:"coop-pilot-001",factionID:11,warID:"w1",campaignID:"c1"}}};
 const treasury={version:1,reservations:{s1:{reservationID:"s1",
  warID:"w1",campaignID:"c1",factionID:11,cents:10000,status:"HELD"}}};
 const ownerCommands=[];
 const director=createWarGateStaging({
  env,clock:()=>now,readWar:()=>war,readFleet:()=>fleet,
  readTreasury:()=>treasury,sceneForSystem:id=>id===101?scene:null,
  getGate:id=>gates[id],
  getController:id=>id===501?{
   entityID:501,systemID:101,currentTargetID:0,lastAggressorID:0,
   manualOrder:null
  }:null,
  bridge:{issue:request=>{ownerCommands.push({owner:request.owner,
   action:request.action});return request.execute();}},
  warpToEntity:()=>{issued++;return {success:true}},
  isTactical:()=>busy,isAmmoRetreat:()=>false,maxOrders:1
 });
 return {env,war,fleet,treasury,ship,scene,gates,ownerCommands,
  director,tick:()=>director.tick({systemIDs:[101]}),
  time:ms=>now+=ms,block:x=>busy=x,get issued(){return issued}};
}
test("funded attacker patrol uses WAR order to warp to verified reciprocal gate",()=>{
 const f=fixture(),out=f.tick();
 assert.equal(out.status,"OBSERVED");
 assert.equal(out.orders.length,1);
 assert.equal(out.orders[0].action,"NATIVE_WARP_TO_REAL_GATE");
 assert.equal(out.orders[0].phase,"STAGING_ONLY_NOT_TRANSFER");
 assert.deepEqual(f.ownerCommands,[{owner:"WAR",action:"warp-to-gate"}]);
 assert.equal(f.issued,1);
 assert.equal(f.fleet.ships[501].systemID,101);
 assert.equal(f.ship.position.x,0);
 assert.equal(f.treasury.reservations.s1.cents,10000);
});
test("no second warp during native pending approach window",()=>{
 const f=fixture();f.tick();
 assert.equal(f.tick().orders.length,0);
 assert.equal(f.issued,1);
});
test("gate arrival only observes physical presence, NEVER transfers hull",()=>{
 const f=fixture();f.ship.position.x=1000000;
 const out=f.tick();
 assert.equal(out.orders.length,0);
 assert.equal(out.observations[0].status,"AT_REAL_GATE");
 assert.equal(out.observations[0].phase,"AWAITING_NATIVE_WAR_FLEET_TRANSFER");
 assert.equal(f.fleet.ships[501].systemID,101);
 assert.equal(f.issued,0);
});
test("no route with nonreciprocal native stargates",()=>{
 const f=fixture();f.gates[802].destinationID=1000;
 assert.equal(f.tick().orders.length,0);
 assert.equal(f.issued,0);
});
test("unfunded, refunded or mismatched native escrow cannot trigger gate warp",()=>{
 const f=fixture();delete f.treasury.reservations.s1;
 assert.equal(f.tick().orders.length,0);
 f.treasury.reservations.s1={warID:"w1",campaignID:"c1",
  factionID:11,cents:10000,status:"REFUNDED"};
 assert.equal(f.tick().orders.length,0);
 f.treasury.reservations.s1.status="HELD";
 f.treasury.reservations.s1.factionID=22;
 assert.equal(f.tick().orders.length,0);
});
test("ceased war, assault and wrong-faction or nonphysical fleet do not stage",()=>{
 const f=fixture();f.war.wars.w1.state="ENDED";
 assert.equal(f.tick().orders.length,0);
 f.war.wars.w1.state="ACTIVE";f.fleet.ships[501].factionID=22;
 assert.equal(f.tick().orders.length,0);
 f.fleet.ships[501].factionID=11;f.ship.nativeNpc=false;
 assert.equal(f.tick().orders.length,0);
});
test("an ASSAULT campaign still stages the attacker that is outside the target",()=>{
 const f=fixture();f.war.campaigns.c1.state="ASSAULT";
 const out=f.tick();
 assert.equal(out.orders.length,1);
 assert.equal(out.orders[0].campaignState,"ASSAULT");
 assert.equal(out.orders[0].action,"NATIVE_WARP_TO_REAL_GATE");
 // the same hull already inside the target system needs no crossing
 const arrived=fixture();arrived.war.campaigns.c1.state="ASSAULT";
 arrived.fleet.ships[501].systemID=202;
 assert.deepEqual(arrived.tick().skips,
  [{campaignID:"c1",reason:"NO_ATTACKER_SHIP_IN_SOURCE:101"}]);
});
test("an explicitly waived paper supply stages a real hull but stays labelled",()=>{
 const f=fixture();
 delete f.treasury.reservations.s1;
 f.war.campaigns.c1.supplyReservationID="paper-supply:c1";
 const out=f.tick();
 assert.equal(out.orders.length,1);
 assert.equal(out.orders[0].supply,"PAPER_UNFUNDED_EXPLICIT");
 // a paper id for a DIFFERENT campaign is not this campaign's waiver
 const other=fixture();delete other.treasury.reservations.s1;
 other.war.campaigns.c1.supplyReservationID="paper-supply:c2";
 assert.equal(other.tick().orders.length,0);
 assert.equal(other.tick().skips[0].reason,"SUPPLY_RESERVATION_MISSING:paper-supply:c2");
 // a real reservation keeps the strict escrow proof
 const strict=fixture();
 assert.equal(strict.tick().orders[0].supply,"REAL_HELD_ESCROW");
});
test("tactical retreat and disabled flag suppress approach",()=>{
 const f=fixture();f.block(true);
 assert.equal(f.tick().orders.length,0);
 f.block(false);f.env.EVEJS_COOP_FACTION_WAR_GATE_APPROACH="0";
 assert.equal(gate(f.env),false);assert.equal(f.tick().status,"DISABLED");
 assert.equal(f.issued,0);
});
test("every refusal names the exact precondition that failed",()=>{
 const f=fixture();
 // an unfunded campaign reports the missing reservation, never silence
 delete f.treasury.reservations.s1;
 assert.deepEqual(f.tick().skips,[{campaignID:"c1",
  reason:"SUPPLY_RESERVATION_MISSING:s1"}]);
 f.treasury.reservations.s1={reservationID:"s1",warID:"w1",campaignID:"c1",
  factionID:11,cents:10000,status:"REFUNDED"};
 assert.deepEqual(f.tick().skips,[{campaignID:"c1",reason:"SUPPLY_NOT_HELD:REFUNDED"}]);
 f.treasury.reservations.s1.status="HELD";
 f.treasury.reservations.s1.campaignID="other";
 assert.equal(f.tick().skips[0].reason,"SUPPLY_CAMPAIGN_MISMATCH:other");
 f.treasury.reservations.s1.campaignID="c1";
 f.war.wars.w1.state="ENDED";
 assert.equal(f.tick().skips[0].reason,"WAR_NOT_ACTIVE:ENDED");
});
test("a missing source scene, attacker or reciprocal gate is reported verbatim",()=>{
 const f=fixture();
 f.gates[802].destinationID=1000;
 assert.deepEqual(f.tick().skips,[{campaignID:"c1",
  reason:"NO_RECIPROCAL_NATIVE_GATE"}]);
 f.gates[802].destinationID=801;
 f.fleet.ships[501].systemID=202;
 assert.deepEqual(f.tick().skips,[{campaignID:"c1",
  reason:"NO_ATTACKER_SHIP_IN_SOURCE:101"}]);
 f.fleet.ships[501].systemID=101;
 const empty=createWarGateStaging({
  env:flags(),clock:()=>100000,readWar:()=>f.war,readFleet:()=>f.fleet,
  readTreasury:()=>f.treasury,sceneForSystem:()=>null,getGate:id=>f.gates[id],
  getController:()=>null,warpToEntity:()=>{throw Error("must not warp")},
  bridge:{issue:r=>r.execute()}
 });
 assert.deepEqual(empty.tick({systemIDs:[101]}).skips,
  [{campaignID:"c1",reason:"SOURCE_SCENE_MISSING:101"}]);
});
test("the durable follow order is forwarded to the gate travel authority",()=>{
 const f=fixture(),asked=[];
 const director=createWarGateStaging({
  env:flags(),clock:()=>100000,readWar:()=>f.war,readFleet:()=>f.fleet,
  readTreasury:()=>f.treasury,sceneForSystem:()=>f.scene,
  getGate:id=>f.gates[id],
  getController:id=>id===501?{
   entityID:501,systemID:101,currentTargetID:0,lastAggressorID:0,
   manualOrder:null}:null,
  bridge:{issue:r=>r.execute()},
  warpToEntity:()=>({success:false,errorMsg:"WARP_DISTANCE_TOO_CLOSE"}),
  orderFollow:(entityID,targetID,options)=>{
   asked.push({entityID,targetID,options});return true;
  }
 });
 const out=director.tick({systemIDs:[101]});
 assert.deepEqual(asked,[{entityID:501,targetID:801,options:{rangeMeters:1000}}]);
 assert.equal(out.orders[0].action,"NATIVE_SUBWARP_TO_REAL_GATE");
 assert.equal(out.orders[0].order,"MANUAL_FOLLOW_ORDER");
 assert.equal(out.orders[0].phase,"STAGING_SUBWARP_APPROACH_ONLY_NOT_TRANSFER");
});
test("gateReason names every missing env flag",()=>{
 const env=flags();env.EVEJS_COOP_WAR_TREASURY="0";
 delete env.EVEJS_COOP_ALIFE;
 assert.equal(gateReason(env),"WAR_GATE_FLAGS_INCOMPLETE:EVEJS_COOP_WAR_TREASURY,"+
  "EVEJS_COOP_ALIFE|EVEJS_COOP_NPC_ORDER_ARBITER");
 assert.equal(gateReason(flags()),null);
 const f=fixture();
 f.env.EVEJS_COOP_FACTION_WAR_GATE_APPROACH="0";
 const off=f.director.tick({systemIDs:[101]});
 assert.equal(off.status,"DISABLED");
 assert.equal(off.reason,
  "WAR_GATE_FLAGS_INCOMPLETE:EVEJS_COOP_FACTION_WAR_GATE_APPROACH");
 assert.deepEqual(off.skips,[]);
});
