import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWarDemobilizer,enabled}=require("../integration/coopWarDemobilizer.cjs");
const flags=()=>({EVEJS_COOP_FACTION_WAR:"1",
 EVEJS_COOP_FACTION_WAR_FLEETS:"1",
 EVEJS_COOP_FACTION_WAR_DEMOBILIZE:"1",
 EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1",EVEJS_COOP_ALIFE:"1"});
function fixture(){
 const env=flags();
 const state={version:1,wars:{w1:{state:"ACTIVE",attackerFactionID:11,
  defenderFactionID:22}},campaigns:{c1:{campaignID:"c1",warID:"w1",
  state:"OCCUPIED",revision:3}}};
 const fleet={version:1,ships:{"501":{entityID:501,systemID:101,
  pilotID:"coop-pilot-001",factionID:11,fleetID:"fw-c1-11",
  warID:"w1",campaignID:"c1"}},processed:{},history:[]};
 const links=[{pilotID:"coop-pilot-001",entityID:501,
  systemID:101,role:"patrol"}];
 let lease=[],fail=false;
 const commands=[];
 const registry={
  snapshot:()=>structuredClone(fleet),
  execute:command=>{
   commands.push(command);
   if(fail)return {status:"BLOCKED",reason:"NATIVE_HULL_BUSY"};
   if(!["OCCUPIED","CANCELLED"].includes(state.campaigns.c1.state))
    return {status:"BLOCKED",reason:"WAR_NOT_TERMINAL"};
   delete fleet.ships[String(command.entityID)];
   return {status:"APPLIED",receipt:{type:"DEMOBILIZE"}};
  }
 };
 const director=createWarDemobilizer({registry,env,
  readWarState:()=>state,readLinks:()=>links,
  getOrderLeases:()=>lease,clock:()=>100000,maxPerTick:2});
 return {env,state,fleet,links,registry,commands,director,
  leases:x=>lease=x,fail:x=>fail=x,
  tick:()=>director.tick({systemIDs:[101]})};
}
test("terminal OCCUPIED returns original idle NPC to native patrol pool",()=>{
 const f=fixture(),res=f.tick();
 assert.equal(res.status,"OBSERVED");assert.equal(res.demobilized.length,1);
 assert.equal(res.demobilized[0].physicalShipPreserved,true);
 assert.equal(f.commands[0].campaignRevision,3);
 assert.equal(f.commands[0].proofID,"native-demob:c1:501");
 assert.deepEqual(f.fleet.ships,{});
 assert.equal(f.tick().demobilized.length,0);
});
test("war still fighting PREPARING or ASSAULT never demobilizes",()=>{
 const f=fixture();f.state.campaigns.c1.state="PREPARING";
 assert.equal(f.tick().demobilized.length,0);
 f.state.campaigns.c1.state="ASSAULT";
 assert.equal(f.tick().demobilized.length,0);
 assert.equal(f.commands.length,0);
});
test("native cancellation only under ended war can demobilize",()=>{
 const f=fixture();f.state.campaigns.c1.state="CANCELLED";
 assert.equal(f.tick().demobilized.length,0);
 f.state.wars.w1.state="ENDED";
 assert.equal(f.tick().demobilized.length,1);
});
test("uncertain native gate transfer refuses release",()=>{
 const f=fixture();f.fleet.transfers={"501":{phase:"NATIVE_COMMITTED"}};
 assert.equal(f.tick().demobilized.length,0);
 assert.equal(f.commands.length,0);
});
test("an ACTIVE or UNKNOWN shared arbiter lease blocks demobilization",()=>{
 const f=fixture();
 f.leases([{entityID:501,phase:"OUTCOME_UNKNOWN"}]);
 assert.equal(f.tick().demobilized.length,0);
 f.leases([{entityID:501,phase:"ACTIVE",expiresAt:200000}]);
 assert.equal(f.tick().demobilized.length,0);
 f.leases([{entityID:501,phase:"ACTIVE",expiresAt:90000}]);
 assert.equal(f.tick().demobilized.length,1);
});
test("duplicated pilot links or changed system reject release",()=>{
 const f=fixture();
 f.links.push({...f.links[0],entityID:999});
 assert.equal(f.tick().demobilized.length,0);
 f.links.pop();f.links[0].systemID=202;
 assert.equal(f.tick().demobilized.length,0);
});
test("no successful release when authoritative native writer refuses",()=>{
 const f=fixture();f.fail(true);
 const result=f.tick();
 assert.equal(result.demobilized.length,0);
 assert.equal(f.fleet.ships["501"].entityID,501);
});
test("all flags default off with no mutations",()=>{
 const f=fixture();f.env.EVEJS_COOP_FACTION_WAR_DEMOBILIZE="0";
 assert.equal(enabled(f.env),false);
 assert.equal(f.tick().status,"DISABLED");
 assert.equal(f.commands.length,0);
});
