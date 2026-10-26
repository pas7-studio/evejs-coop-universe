import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWarMilitiaIntel}=require("../integration/coopWarMilitiaIntel.cjs");
const {KEY:WAR_KEY}=require("../integration/coopFactionWarStore.cjs");
const {KEY:OBJ_KEY}=require("../integration/coopWarObjectiveAdjudicator.cjs");
function fixture(){
 const env={EVEJS_COOP_FACTION_WAR:"1",EVEJS_COOP_FACTION_MILITIA_AGENT:"1",
  EVEJS_COOP_FACTION_WAR_PLAYER_CAPTURE:"1",
  EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1"};
 const war={version:1,wars:{w1:{warID:"w1",state:"ACTIVE",
  attackerFactionID:11,defenderFactionID:22}},territories:{},
  campaigns:{c1:{campaignID:"c1",state:"ASSAULT",warID:"w1",
   targetSystemID:202,revision:2,objectiveEvidence:[]}},
  enlistments:{"9001":{characterID:9001,factionID:11,
   status:"ACTIVE",enlistedAt:99}},processed:{},history:[]};
 const objectives={version:1,objectives:{c1:{
  campaignID:"c1",warID:"w1",structureID:700,
  systemID:202,ownerCorporationID:32,ownerFactionID:22,
  typeID:1010,position:{x:0,y:0,z:0},boundAt:100,
  state:"NEUTRALIZED",destroyedAt:101,
  combatProofID:"structure-kill:9000"}},
  usedStructureIDs:{"700":"c1"},
  captureSeries:{c1:{count:3,startedAt:200,lastAt:260}},
  processed:{},history:[]};
 const rows=new Map([[WAR_KEY,war],[OBJ_KEY,objectives]]);
 const gameStore={coopAtomicNativeRows:{transact:([t],fn)=>
  fn({get:(_t,k)=>rows.get(k)})}};
 const reader=createWarMilitiaIntel({gameStore,env});
 return {env,war,objectives,rows,reader};
}
test("enlisted attacker sees current real front and three of four samples",()=>{
 const f=fixture(),res=f.reader.read({characterID:9001,factionID:11});
 assert.equal(res.status,"OBSERVED");
 assert.match(res.text,/ATTACK system 202 \(ASSAULT\)/);
 assert.match(res.text,/Structure down, hold 20 km/);
 assert.match(res.text,/hold 3\/4/);
});
test("defender militia reads DEFEND perspective, not fake ownership",()=>{
 const f=fixture();
 f.war.enlistments["9001"].factionID=22;
 const res=f.reader.read({characterID:9001,factionID:22});
 assert.equal(res.status,"OBSERVED");
 assert.match(res.text,/DEFEND system 202/);
});
test("only actor's own live faction enlistment grants briefing",()=>{
 const f=fixture();
 assert.equal(f.reader.read({characterID:9001,factionID:22}).status,
  "NOT_ENLISTED");
 assert.equal(f.reader.read({characterID:9002,factionID:11}).status,
  "NOT_ENLISTED");
 f.war.enlistments["9001"].status="LEFT";
 assert.equal(f.reader.read({characterID:9001,factionID:11}).status,
  "NOT_ENLISTED");
});
test("no flags, no front lines or no SQL returns conservative text",()=>{
 const f=fixture();
 f.env.EVEJS_COOP_FACTION_WAR_PLAYER_CAPTURE="0";
 assert.equal(f.reader.read({characterID:9001,factionID:11}).status,
  "DISABLED");
 f.env.EVEJS_COOP_FACTION_WAR_PLAYER_CAPTURE="1";
 f.war.campaigns={};
 assert.match(f.reader.read({characterID:9001,factionID:11}).text,
  /No currently verified faction-war front lines/);
 f.rows.delete(WAR_KEY);
 assert.equal(f.reader.read({characterID:9001,factionID:11}).status,
  "UNAVAILABLE");
});
