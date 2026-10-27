import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import fs from "node:fs";
const require=createRequire(import.meta.url);
const {WARZONES,warzonePairs,warzoneOpponent,declaredOpponents,militiaSituation}=require("../integration/coopMilitiaWarData.cjs");

const WAR="war:500001-500004";
function warState({state="ACTIVE",campaignState="ASSAULT",targetSystemID=30000140}={}){
 return {version:1,
  wars:{[WAR]:{warID:WAR,attackerFactionID:500001,defenderFactionID:500004,state}},
  campaigns:{[WAR+":campaign:"+targetSystemID]:{campaignID:WAR+":campaign:"+targetSystemID,
   warID:WAR,targetSystemID,state:campaignState}},
  territories:{},enlistments:{},processed:{},history:[]};
}
const caldari={factionID:500001,name:"Caldari State",militiaCorporationID:1000180};
const gallente={factionID:500004,name:"Gallente Federation",militiaCorporationID:1000181};
const serpentis={factionID:500020,name:"Serpentis",militiaCorporationID:null};

test("the warzone pairing is the game's own Caldari <-> Gallente / Amarr <-> Minmatar data",()=>{
 assert.deepEqual(warzonePairs().map(p=>p.factionIDs).sort(),
  [[500001,500004],[500003,500002]]);
 assert.deepEqual(warzoneOpponent(500001),{warzoneID:2,opponentFactionID:500004});
 assert.deepEqual(warzoneOpponent(500004),{warzoneID:2,opponentFactionID:500001});
 assert.equal(warzoneOpponent(500011),null);
});

test("the mirrored warzones still match the deployed faction-warfare service",(t)=>{
 const file="C:/Games/EveCoop/upstream-evejs/Code/server/src/services/map/fwWarzoneSolarsystemService.js";
 if(!fs.existsSync(file))return t.skip("upstream checkout not present on this machine");
 const src=fs.readFileSync(file,"utf8");
 for(const [warzoneID,pair] of Object.entries(WARZONES)){
  const match=src.match(new RegExp("WARZONE_[A-Z_]+ = "+warzoneID+";"));
  assert.ok(match,"warzone "+warzoneID+" is no longer declared by the service");
  for(const factionID of pair)assert.match(src,new RegExp("= "+factionID+";|, "+factionID+",|\\[\\s*"+factionID));
 }
 assert.match(src,/CALDARI_GALLENTE/);
});

test("a declared war is the enemy list; the static pairing is only the fallback",()=>{
 const declared=declaredOpponents(500001,warState());
 assert.equal(declared.length,1);
 assert.equal(declared[0].opponentFactionID,500004);
 assert.equal(declared[0].campaigns[0].state,"ASSAULT");
 const s=militiaSituation({characterID:5,character:{characterID:5,factionID:500001},
  faction:caldari,warState:warState()});
 assert.equal(s.status,"MILITIA_AVAILABLE");
 assert.equal(s.militiaCorporationID,1000180);
 assert.deepEqual(s.enemyFactionIDs,[500004]);
 assert.deepEqual(s.fronts,[{warID:WAR,campaignID:WAR+":campaign:30000140",systemID:30000140}]);
});

test("no declared war still names the game's real opponent, with no front",()=>{
 const s=militiaSituation({characterID:5,character:{characterID:5,factionID:500001},
  faction:caldari,warState:{version:1,wars:{},campaigns:{},territories:{},enlistments:{},processed:{},history:[]}});
 assert.deepEqual(s.enemyFactionIDs,[500004]);
 assert.deepEqual(s.fronts,[]);
 assert.equal(s.declaredWars.length,0);
});

test("a faction without a militia corporation reports the exact missing row",()=>{
 const s=militiaSituation({characterID:5,character:{characterID:5,factionID:500020},
  faction:serpentis,warState:warState()});
 assert.equal(s.status,"NO_MILITIA_CORPORATION");
 assert.equal(s.factionID,500020);
});

test("the character record, not the caller, decides the faction",()=>{
 const s=militiaSituation({characterID:5,character:{characterID:5,factionID:500001},
  faction:gallente,warState:warState()});
 assert.equal(s.status,"FACTION_NOT_FOUND");
 assert.equal(militiaSituation({characterID:6,character:{characterID:5,factionID:500001},
  faction:caldari,warState:warState()}).status,"NO_CHARACTER");
});
