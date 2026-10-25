import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createOperations,oreAmount}=require("../integration/coopFleetOperations.cjs");
const {patch}=require("../scripts/coop-p1-operations-native-patch.cjs");
const {specs,transform}=require("../scripts/patch-evejs-coop.cjs");
let time=100000;
const scene={systemID:30000144,entities:new Map(),sessions:new Map(),
 getEntityByID(id){return this.entities.get(id)||null}};
function ship(itemID,nativeNpc,position={x:100,y:100,z:100}){
 return {itemID,kind:"ship",nativeNpc,position};
}
scene.entities.set(9001,ship(9001,false));
scene.entities.set(9002,ship(9002,false,{x:200,y:100,z:100}));
scene.entities.set(6001,ship(6001,true,{x:50000,y:100,z:100})); // pirate
scene.entities.set(6101,ship(6101,true,{x:50002,y:100,z:100})); // real hauler
scene.entities.set(6102,ship(6102,true,{x:100000,y:100,z:100})); // miner
const pilot1={characterID:101,_space:{shipID:9001,systemID:30000144,initialStateSent:true}};
const pilot2={characterID:102,_space:{shipID:9002,systemID:30000144,initialStateSent:true}};
scene.sessions.set(101,pilot1);
scene.sessions.set(102,pilot2);
const nativeFleet={members:new Map([[101,{}],[102,{}]])};
const tags=[],messages=[];
const fleetRuntime={getFleetForCharacter:id=>nativeFleet.members.has(id)?nativeFleet:null,
 getMemberRecord:(f,id)=>f.members.get(id)||null,
 setFleetTargetTag:(session,entityID,tag)=>{
  if(session!==pilot1)return false; // real commander permission
  tags.push({entityID,tag});return true;
 }};
const nativeFleets=[{systemID:30000144,minerEntityIDs:[6102],haulerEntityIDs:[6101]}];
const cargo=new Map([[6101,[{typeID:123,quantity:53,moduleID:0}]],
 [6102,[{typeID:123,quantity:12,moduleID:0}]]]);
const ops=createOperations({clock:()=>time,getScene:()=>scene,
 getFleets:()=>fleetRuntime,getMiningFleets:()=>nativeFleets,
 getCargo:id=>cargo.get(id)||[],getWreck:()=>null,
 send:(session,message)=>{messages.push([session.characterID,message]);}});
const valid={scene,systemID:30000144,fleetShips:[{id:6101,role:"hauler"},{id:6102,role:"miner"}]};
const action={pirateID:6001,targetID:6101,targetRole:"hauler",action:"attack"};

test("real convoy ore counts only native full cargo stacks, never virtual supply",()=>{
 assert.equal(oreAmount([{typeID:23,quantity:42,moduleID:0},
  {typeID:23,quantity:4,moduleID:8},{typeID:0,quantity:9,moduleID:0},
  {typeID:23,quantity:-1,moduleID:0},
  {typeID:23,quantity:1.5,moduleID:0}]),42);
});
test("no incident without a successful native NPC raid order against true stock mining membership",()=>{
 assert.equal(ops.recordNativeRaid({...valid,actions:[]}).accepted,0);
 assert.equal(ops.recordNativeRaid({...valid,actions:[{...action,action:"fake"}]}).accepted,0);
 assert.equal(ops.recordNativeRaid({...valid,fleetShips:[],actions:[action]}).accepted,0);
 assert.equal(ops.recordNativeRaid({...valid,actions:[{...action,targetID:9001}]}).accepted,0);
 assert.equal(ops.recordNativeRaid({...valid,actions:[{...action,pirateID:9001}]}).accepted,0);
 assert.equal(ops.snapshot().incidents.length,0);
});
test("native attack creates visible incident and authentic cargo intelligence for both fleet roles",()=>{
 const recorded=ops.recordNativeRaid({...valid,actions:[action]});
 assert.deepEqual(recorded,{status:"RECORDED_NATIVE_ACTION",accepted:1});
 const state=ops.execute(pilot1,"status");
 assert.equal(state.status,"LIVE_NATIVE_RAID");
 assert.match(state.message,/UNDER_ATTACK/);
 assert.match(state.message,/real ore 53/);
 assert.equal(ops.execute(pilot2,"convoy").status,"NATIVE_CARGO_VISIBLE");
 assert.match(ops.execute(pilot2,"convoy").message,/hauler #6101 ore=53/);
 assert.equal(ops.execute(pilot2,"status").status,"LIVE_NATIVE_RAID");
});
test("native commander marks attacker (tag 1) and escort target (tag 2) for whole fleet",()=>{
 const a=ops.execute(pilot1,"focus 6001");
 const b=ops.execute(pilot1,"guard 6101");
 assert.equal(a.status,"NATIVE_FLEET_TARGET_TAG_SET");
 assert.equal(b.status,"NATIVE_FLEET_TARGET_TAG_SET");
 assert.deepEqual(tags,[{entityID:6001,tag:"1"},{entityID:6101,tag:"2"}]);
 assert.equal(messages.filter(x=>x[0]===102).length,2);
});
test("non-commanders, outsiders and unrelated native ships can't turn operations into a GM attack",()=>{
 assert.equal(ops.execute(pilot2,"focus 6001").status,"NATIVE_COMMAND_PERMISSION_DENIED");
 assert.equal(ops.execute(pilot1,"focus 9002").status,"NO_VERIFIED_INCIDENT_TARGET");
 assert.equal(ops.execute(pilot1,"guard 6001").status,"NO_VERIFIED_INCIDENT_TARGET");
 assert.equal(ops.execute(pilot1,"focus ???").status,"INVALID_TARGET");
 const outsider={characterID:103,_space:{shipID:9003,systemID:30000144,initialStateSent:true}};
 scene.entities.set(9003,ship(9003,false));scene.sessions.set(103,outsider);
 assert.equal(ops.execute(outsider,"focus 6001").status,"JOIN_NATIVE_EVE_FLEET_FIRST");
 scene.sessions.delete(103);scene.entities.delete(9003);
});
test("different verified crew commitments have distinct play roles, but no fabricated payout",()=>{
 assert.equal(ops.execute(pilot1,"role intercept 6001").status,"ROLE_DECLARED");
 assert.equal(ops.execute(pilot2,"role escort 6001").status,"COMPLEMENTARY_ROLES_DECLARED");
 assert.equal(ops.execute(pilot2,"role salvage 6001").status,"COMPLEMENTARY_ROLES_DECLARED");
 assert.equal(ops.execute(pilot2,"role unknown").status,"INVALID_ROLE");
 assert.equal(ops.snapshot().roles.length,2);
 assert.equal(tags.length,2,"roles must not auto-tag or fire weapons");
});
test("disconnects, duplicated sessions, stale cargo or destroyed targets cannot be exploited",()=>{
 const duplicate={characterID:102,_space:{...pilot2._space}};
 scene.sessions.set("duplicate",duplicate);
 assert.equal(ops.execute(pilot2,"focus 6001").status,"NEED_TWO_DISTINCT_READY_FLEET_SHIPS");
 scene.sessions.delete("duplicate");
 cargo.set(6101,[]);
 assert.equal(ops.execute(pilot1,"status").status,"LIVE_NATIVE_RAID",
  "fighting ships remain visible even if cargo is unloaded");
 scene.entities.delete(6001);
 assert.equal(ops.execute(pilot1,"status").status,"NO_NATIVE_RAID");
 const result=ops.execute(pilot1,"focus 6001");
 assert.equal(result.status,"NO_VERIFIED_INCIDENT_TARGET");
});
test("incidents expire, do not mint economic stock, and recent events remain bounded",()=>{
 const local=createOperations({clock:()=>time,getScene:()=>scene,getFleets:()=>fleetRuntime,
  getMiningFleets:()=>nativeFleets,getCargo:id=>cargo.get(id)||[],
  getWreck:()=>null,send:()=>{},ttlMs:60000,maxIncidents:1});
 cargo.set(6101,[{typeID:123,quantity:20,moduleID:0}]);
 scene.entities.set(6001,ship(6001,true));
 assert.equal(local.recordNativeRaid({...valid,actions:[action]}).accepted,1);
 time+=60001;
 assert.equal(local.snapshot().incidents.length,0);
 assert.equal(local.execute(pilot1,"status").status,"NO_NATIVE_RAID");
});

test("native chat overlay is one opt-in call, reversible and parses against pinned EveJS",t=>{
 const snippet='  const argumentText = rest.join(" ").trim();';
 const file="server/src/services/chat/chatCommands.js";
 const a=patch(snippet,file);
 assert.match(a,/EVEJS_COOP_P1_OPERATIONS/);
 assert.equal(patch(a,file),a);
 assert.equal(patch(a,file,true),snippet);
 const native=process.env.EVEJS_COOP_CODE_PATH;
 if(!native){t.diagnostic("Pinned upstream checkout unavailable: source-level test skipped");return;}
 const spec=specs.find(x=>x.file===file);assert.ok(spec);
 const checkout=fs.readFileSync(path.join(native,file),"utf8");
 const pristine=transform(checkout,spec,true),applied=transform(pristine,spec,false);
 assert.notEqual(applied,pristine);
 assert.equal(transform(applied,spec,false),applied);
 assert.equal(transform(applied,spec,true),pristine);
 new vm.Script(applied,{filename:file});
});
test("world integration records only successful native NPC raid actions when feature flag is set",()=>{
 const src=fs.readFileSync(new URL("../integration/coopVirtualWorldRuntime.cjs",import.meta.url),"utf8");
 const guard=src.indexOf('process.env.EVEJS_COOP_P1_OPERATIONS==="1"');
 const call=src.indexOf("recordNativeRaid({scene,systemID,actions:result.actions,fleetShips})",guard);
 const notifier=src.lastIndexOf("notifyRaid(scene,result.actions)",guard);
 assert.ok(guard>notifier&&call>guard);
 assert.ok(src.slice(0,guard).includes("if(result.actions.length)"));
});
