import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {isAuthorizedStockMiningRaid,liveFleetShips}=
 require("../integration/coopNativeRaidEligibility.cjs");
const systemID=30000144;
const attacker={itemID:501,kind:"ship",nativeNpc:true};
const target={itemID:201,kind:"ship",nativeNpc:true};
const source={pilotID:"coop-pilot-010",role:"pirate",entityID:501,systemID};
const victim={pilotID:"coop-pilot-016",role:"miner",entityID:201,systemID};
const pilots=[{id:source.pilotID,faction:"independent"},
 {id:victim.pilotID,faction:"frontier"}];
const params=()=>({systemID,attacker,target,links:[source],
 pilots,fleetShips:[{id:201,role:"miner"}]});
test("real native but unnamed stock miner is a legal pirate raid target",()=>{
 assert.equal(isAuthorizedStockMiningRaid(params()),true);
 assert.equal(isAuthorizedStockMiningRaid({...params(),target:{...target,nativeNpc:false}}),false);
 assert.equal(isAuthorizedStockMiningRaid({...params(),target:{...target,kind:"station"}}),false);
 assert.equal(isAuthorizedStockMiningRaid({...params(),fleetShips:[]}),false);
 assert.equal(isAuthorizedStockMiningRaid({...params(),systemID:30000142}),false);
 assert.equal(isAuthorizedStockMiningRaid({...params(),attacker:target,target:attacker}),false);
});
test("named miner needs opposing faction; same-faction and unknown faction fail closed",()=>{
 assert.equal(isAuthorizedStockMiningRaid({...params(),links:[source,victim]}),true);
 assert.equal(isAuthorizedStockMiningRaid({...params(),links:[source,victim],
  pilots:[pilots[0],{...pilots[1],faction:"independent"}]}),false);
 assert.equal(isAuthorizedStockMiningRaid({...params(),links:[source,victim],pilots:[]}),false);
 assert.equal(isAuthorizedStockMiningRaid({...params(),links:[source,{...victim,role:"patrol"}]}),false);
});
test("pirate must have exact active co-op pilot link; prevent role spoof and foreign target",()=>{
 assert.equal(isAuthorizedStockMiningRaid({...params(),links:[{...source,role:"patrol"}]}),false);
 assert.equal(isAuthorizedStockMiningRaid({...params(),links:[]}),false);
 assert.equal(isAuthorizedStockMiningRaid({...params(),links:[{...source,systemID:30000142}]}),false);
 assert.equal(isAuthorizedStockMiningRaid({...params(),links:[source,source]}),false);
 assert.equal(isAuthorizedStockMiningRaid({...params(),fleetShips:[{id:201,role:"trader"}]}),false);
});
test("authoritative EveJS fleet members are validated as live native hulls",()=>{
 const ships=new Map([[201,target],[202,{itemID:202,kind:"ship",nativeNpc:false}],
  [203,{itemID:203,kind:"station",nativeNpc:true}]]);
 const scene={getEntityByID:id=>ships.get(id)};
 const fleets=[{systemID,minerEntityIDs:[201,201,202,203],haulerEntityIDs:[204]}];
 assert.deepEqual(liveFleetShips(fleets,scene),[{id:201,role:"miner"}]);
 assert.deepEqual(liveFleetShips(fleets,{getEntityByID:()=>null}),[]);
});
function runHostility({attack=true,member=true,npcRaids=true,sourceLink=source,playerTarget=false}={}){
 const targetShip={...target,nativeNpc:!playerTarget};
 const controllerA={entityID:501,systemID,
  manualOrder:attack?{type:"attack",targetID:201}:null,lastAggressedAtMs:0};
 const controllerB={entityID:201,systemID,manualOrder:null};
 const file=fs.readFileSync(new URL("../integration/coopNpcHostility.cjs",import.meta.url),"utf8");
 const module={exports:{}};
 vm.runInNewContext(file,{
  module,exports:module.exports,Date,console,
  process:{env:{
   EVEJS_COOP_RIVAL_NPC_COMBAT:"1",
   EVEJS_COOP_NPC_RAIDS:npcRaids?"1":"0"
  }},
  require:id=>{
   if(id==="node:fs")return {readFileSync:path=>
    path.endsWith("coop-npc-links.json")?JSON.stringify({version:1,links:{source:sourceLink}}):
     JSON.stringify({version:1,pilots})};
   if(id==="./npc/npcRegistry")return {
    getControllerByEntityID:id=>id===501?controllerA:id===201?controllerB:null
   };
   if(id==="../services/mining/miningNpcOperations")return {
    getMiningFleetsForSystem:()=>member?[{systemID,minerEntityIDs:[201]}]:[]
   };
   if(id==="./coopNativeRaidEligibility")
    return require("../integration/coopNativeRaidEligibility.cjs");
   throw Error("Unexpected dependency: "+id);
  }
 },{filename:"coopNpcHostility.cjs"});
 return module.exports.allowsNativeEngagement(attacker,targetShip);
}
test("native combat hook permits only real ordered pirate raid, not generic NPC friendliness",()=>{
 assert.equal(runHostility(),true);
 assert.equal(runHostility({attack:false}),false);
 assert.equal(runHostility({member:false}),false);
 assert.equal(runHostility({npcRaids:false}),false);
 assert.equal(runHostility({sourceLink:{...source,role:"trader"}}),false);
 assert.equal(runHostility({playerTarget:true}),false);
});
