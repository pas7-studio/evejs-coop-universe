import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {verifyStockKill}=require("../integration/coopNpcStockWreckProof.cjs");
const SID=30000144;
function fixture(){
 const attacker={itemID:101,kind:"ship",nativeNpc:true};
 const victim={itemID:301,kind:"ship",nativeNpc:true};
 const physical={itemID:501,launcherID:301,nativeNpcWreck:true};
 const wreck={wreckID:501,systemID:SID,sourceEntityID:301,launcherID:301};
 const scene={systemID:SID,sessions:new Map(),
  getEntityByID:id=>id===101?attacker:id===501?physical:null};
 const options={attackerEntity:attacker};
 const links=[{pilotID:"coop-pilot-001",entityID:101,systemID:SID,role:"pirate"}];
 const fleets=[{systemID:SID,minerEntityIDs:[301],haulerEntityIDs:[]}];
 const verify=(input={})=>verifyStockKill({scene,attacker,victim,wreck,options,links,fleets,...input});
 return {attacker,victim,physical,wreck,scene,options,links,fleets,verify};
}
test("unnamed native stock mining victim proves exact physical pirate attacker",()=>{
 const f=fixture();const proof=f.verify();
 assert.equal(proof.status,"NATIVE_DESTRUCTION_ATTACKER_PROVIDED");
 assert.equal(proof.attackerPilotID,"coop-pilot-001");
 assert.equal(proof.victimEntityID,301);
 assert.equal(proof.wreckID,501);
 assert.equal(proof.victimClass,"UNNAMED_NATIVE_STOCK_MINING_FLEET");
});
test("no explicit upstream killer never creates postraid property right",()=>{
 const f=fixture();
 assert.equal(f.verify({options:{currentTargetID:101}}).status,"UPSTREAM_ATTACKER_NOT_PROVIDED");
});
test("only real current stock fleet member qualifies, not arbitrary NPC or human",()=>{
 const f=fixture();f.fleets[0].minerEntityIDs=[];
 assert.equal(f.verify().status,"STOCK_FLEET_MEMBERSHIP_MISSING");
 f.fleets[0].minerEntityIDs=[301];f.victim.nativeNpc=false;
 assert.equal(f.verify().status,"INVALID_STOCK_KILL_CONTEXT");
});
test("wrong wreck lineage or absent physical wreck rejects proof",()=>{
 const f=fixture();f.wreck.sourceEntityID=900;
 assert.equal(f.verify().status,"INVALID_STOCK_KILL_CONTEXT");
 f.wreck.sourceEntityID=301;f.physical.nativeNpcWreck=false;
 assert.equal(f.verify().status,"NATIVE_WRECK_NOT_PHYSICAL");
});
test("human pilot on source or victim excludes stock raid kill",()=>{
 const f=fixture();f.scene.sessions.set("active",{characterID:4,_space:{shipID:101}});
 assert.equal(f.verify().status,"PLAYER_SHIP_EXCLUDED");
 f.scene.sessions.clear();
 f.scene.sessions.set("victim",{characterID:5,_space:{shipID:301}});
 assert.equal(f.verify().status,"PLAYER_SHIP_EXCLUDED");
});
test("attacker must have exact unique named pirate link; named victim uses other proof",()=>{
 const f=fixture();f.links.push({...f.links[0]});
 assert.equal(f.verify().status,"NOT_UNIQUE_NAMED_PIRATE");
 f.links.pop();f.links[0].role="trader";
 assert.equal(f.verify().status,"NOT_UNIQUE_NAMED_PIRATE");
 f.links[0].role="pirate";f.links.push({pilotID:"coop-pilot-002",
  entityID:301,systemID:SID,role:"miner"});
 assert.equal(f.verify().status,"NAMED_VICTIM_USE_STANDARD_PROOF");
});
