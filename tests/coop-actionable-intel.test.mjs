import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {nearest,build,createAnnouncer}=require("../integration/coopSystemIntel.cjs");
function fixture(){
 const entities=new Map([
  [101,{kind:"ship",position:{x:10000,y:0,z:0}}],
  [102,{kind:"ship",position:{x:10500,y:0,z:0}}],
  [103,{kind:"ship",position:{x:12000,y:0,z:0}}],
  [201,{kind:"ship",position:{x:20000,y:0,z:0}}],
  [301,{kind:"ship",position:{x:0,y:0,z:0}}]
 ]);
 const session={characterID:7,_space:{shipID:301,systemID:30000144,initialStateSent:true},socket:{destroyed:false}};
 const scene={systemID:30000144,getEntityByID:id=>entities.get(Number(id)),sessions:new Map([[7,session]]),
  staticEntities:[{itemID:777,kind:"asteroidBelt",itemName:"Perimeter Belt",position:{x:11000,y:0,z:0}}]};
 const fleets=[{fleetID:456,minerEntityIDs:[101],haulerEntityIDs:[102],responseEntityIDs:[103],loadedHaulerOreQuantity:150}];
 const opts={fleets,pirateIDs:[201]};
 return {session,scene,entities,fleets,opts};
}
test("grounded co-op intel mentions real hauler cargo, escort and pirate positions",()=>{
 const f=fixture();const r=build(f.scene,f.opts);
 assert.equal(r.status,"ACTIVE");
 assert.equal(r.activity.length,2);
 assert.equal(r.activity[0].oreOnHaulers,150);
 assert.equal(r.activity[0].defenders,1);
 assert.match(r.messages[0],/Удвох можна/);
 assert.match(r.messages[0],/Perimeter Belt/);
 assert.match(r.messages[1],/піратських/);
});
test("wreck, ghost and player ships never count as NPC miners, escorts or pirates",()=>{
 const f=fixture();f.entities.get(101).kind="wreck";
 f.entities.delete(102);
 f.opts.pirateIDs=[301];
 const r=build(f.scene,f.opts);
 assert.equal(r.status,"QUIET");
 assert.equal(r.activity.length,0);
});
test("duplicate NPC IDs do not inflate physical ship counts",()=>{
 const f=fixture();f.fleets[0].minerEntityIDs=[101,101];
 f.opts.pirateIDs=[201,201];
 assert.equal(build(f.scene,f.opts).activity[0].miners,1);
 assert.equal(build(f.scene,f.opts).activity[1].count,1);
});
test("invalid ship positions and fabricated static coordinates never become waypoints",()=>{
 const f=fixture();f.entities.get(101).position.x=Infinity;
 assert.equal(nearest(f.scene,f.entities.get(101)),null);
 f.scene.staticEntities[0].position.x=Infinity;
 assert.equal(nearest(f.scene,f.entities.get(201)),null);
});
test("stable physical world does not spam Local every 90 seconds",()=>{
 const f=fixture();let now=500000;const messages=[];
 const b=createAnnouncer({send:(_s,m)=>messages.push(m),clock:()=>now});
 assert.equal(b.announce(f.session,f.scene,f.opts).status,"DELIVERED");
 const original=messages.length;
 now+=91000;
 assert.equal(b.announce(f.session,f.scene,f.opts).status,"UNCHANGED");
 assert.equal(messages.length,original);
 now+=900001;
 assert.equal(b.announce(f.session,f.scene,f.opts).status,"DELIVERED");
});
test("meaningful native ore changes generate new digest after minimum cooldown",()=>{
 const f=fixture();let now=500000;const out=[];
 const b=createAnnouncer({clock:()=>now,send:(_,m)=>out.push(m)});
 assert.equal(b.announce(f.session,f.scene,f.opts).status,"DELIVERED");
 f.fleets[0].loadedHaulerOreQuantity=520;
 now+=91000;
 assert.equal(b.announce(f.session,f.scene,f.opts).status,"DELIVERED");
 assert.match(out.at(-2),/вантаж/);
});
test("unready cross-system, disconnected or missing physical player receives no intel",()=>{
 const f=fixture();const b=createAnnouncer({send:()=>{throw Error("unexpected send");}});
 f.session._space.systemID=30000142;
 assert.equal(b.announce(f.session,f.scene,f.opts).status,"CLIENT_NOT_READY");
 f.session._space.systemID=30000144;f.session.socket.destroyed=true;
 assert.equal(b.announce(f.session,f.scene,f.opts).status,"CLIENT_NOT_READY");
 f.session.socket.destroyed=false;f.entities.delete(301);
 assert.equal(b.announce(f.session,f.scene,f.opts).status,"CLIENT_NOT_READY");
});
test("failed message send is retryable, and ungrounded fleet is QUIET",()=>{
 const f=fixture();let failed=true,now=500000;
 const b=createAnnouncer({clock:()=>now,send:()=>{if(failed)throw Error("chat down");}});
 assert.equal(b.announce(f.session,f.scene,{fleets:[],pirateIDs:[]}).status,"QUIET");
 assert.equal(b.announce(f.session,f.scene,{fleets:f.fleets,pirateIDs:[]}).status,"FAILED");
 failed=false;
 assert.equal(b.announce(f.session,f.scene,{fleets:f.fleets,pirateIDs:[]}).status,"DELIVERED");
});
