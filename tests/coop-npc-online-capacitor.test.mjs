import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import path from "node:path";
const require=createRequire(import.meta.url);
const capacitor=require("../integration/coopNpcCapacitor.cjs");

// Onlining a module requires 95% capacitor (ONLINE_CAPACITOR_CHARGE_RATIO). A native NPC has no
// capacitor manager, so a pirate that just fired cannot reach 95% again and never onlines its
// warp scrambler: measured live as 20 `living-native-warp-point-refused` events with reason
// NOT_ENOUGH_CAPACITOR, while the same hull regenerates at tau ~150 s.
const npcShip={kind:"ship",nativeNpc:true,capacitorCapacity:250,capacitorChargeRatio:0.03};
const playerShip={kind:"ship",session:{characterID:140000005}};
const runtimeFor=(entity)=>({getShipEntityForSession:()=>entity});

test("a sessionless native NPC may online a module without a full capacitor",()=>{
 process.env.EVEJS_COOP_NPC_CAPACITOR="1";
 assert.equal(capacitor.allowsOnlineWithoutCapacitor({npc:"pirate"},{}),false,
  "no entity resolved, no bypass");
 const runtime=runtimeFor(npcShip);
 runtime.getShipEntityForSession=()=>npcShip;
 const entity=runtime.getShipEntityForSession();
 assert.equal(entity.session,undefined);
 assert.equal(capacitor.allowsOnlineWithoutCapacitor({},runtimeFor(npcShip)),true);
});

test("a player ship keeps the 95% rule",()=>{
 process.env.EVEJS_COOP_NPC_CAPACITOR="1";
 assert.equal(capacitor.allowsOnlineWithoutCapacitor({characterID:140000005},runtimeFor(playerShip)),false);
});

test("with the flag off nothing is bypassed",()=>{
 delete process.env.EVEJS_COOP_NPC_CAPACITOR;
 assert.equal(capacitor.allowsOnlineWithoutCapacitor({},runtimeFor(npcShip)),false);
});

test("the dogma online check calls the bypass only for this gate",()=>{
 const source=readFileSync(path.join(
  process.env.EVEJS_FORK_ROOT||"C:/Games/EveCoop/upstream-evejs",
  "Code/server/src/services/dogma/dogmaService.js"),"utf8");
 assert.match(source,/bypassesOnlineCapacitorForNpc\(session\)/);
 assert.match(source,/EVEJS_COOP_NPC_CAPACITOR !== "1"/);
 assert.match(source,/ONLINE_CAPACITOR_CHARGE_RATIO = 95;/);
});
