import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {validPair}=require("../integration/coopNpcHostility.cjs");
const systemID=30000142;
const attacker={itemID:10,kind:"ship",nativeNpc:true};
const target={itemID:20,kind:"ship",nativeNpc:true};
const links=[
 {pilotID:"coop-pilot-001",entityID:10,systemID},
 {pilotID:"coop-pilot-002",entityID:20,systemID}
];
const pilots=[
 {id:"coop-pilot-001",faction:"frontier"},
 {id:"coop-pilot-002",faction:"independent"}
];
const ac={entityID:10,systemID,manualOrder:{type:"attack",targetID:20}};
const tc={entityID:20,systemID,manualOrder:null};
const options=()=>({attacker,target,attackerController:ac,targetController:tc,links,pilots});
test("explicit native attack order between named opposing NPCs is allowed",()=>{
 assert.equal(validPair(options()),true);
});
test("no attack intent, stopped NPC, idle patrol or accidental aggro is allowed",()=>{
 assert.equal(validPair({...options(),attackerController:{...ac,manualOrder:null}}),false);
 assert.equal(validPair({...options(),attackerController:{...ac,manualOrder:{type:"attack",targetID:21}}}),false);
});
test("genuine native retaliation can recognize prior aggression",()=>{
 assert.equal(validPair({...options(),attackerController:{...ac,manualOrder:null,
  lastAggressorID:20,lastAggressedAtMs:Date.now()-1000}}),true);
 assert.equal(validPair({...options(),attackerController:{...ac,manualOrder:null,
  lastAggressorID:20,lastAggressedAtMs:0}}),false);
 assert.equal(validPair({...options(),attackerController:{...ac,manualOrder:null,
  lastAggressorID:20,lastAggressedAtMs:Date.now()-600000}}),false);
});
test("same faction, missing pilot and unlinked ship remain friendly",()=>{
 assert.equal(validPair({...options(),pilots:[...pilots.slice(0,1),{...pilots[1],faction:"frontier"}]}),false);
 assert.equal(validPair({...options(),links:[links[0]]}),false);
});
test("wrong system, non-native entity, player ship and spoofed controller reject",()=>{
 assert.equal(validPair({...options(),target:{...target,nativeNpc:false}}),false);
 assert.equal(validPair({...options(),attacker:{...attacker,kind:"drone"}}),false);
 assert.equal(validPair({...options(),targetController:{...tc,systemID:30000144}}),false);
 assert.equal(validPair({...options(),attackerController:{...ac,entityID:999}}),false);
});
