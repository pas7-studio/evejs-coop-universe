import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require = createRequire(import.meta.url);
const {createBroadcaster} = require("../integration/coopWorldSignals.cjs");
function fixture() {
 const ships = new Map([
  [100, {kind:"ship",position:{x:1,y:2,z:3}}],
  [101, {kind:"ship",position:{x:1,y:2,z:4}}],
  [102, {kind:"ship",position:{x:1,y:2,z:5}}],
  [201, {kind:"ship",position:{x:4,y:5,z:6}}],
  [202, {kind:"ship",position:{x:5,y:5,z:6}}]
 ]);
 const p1={characterID:1,_space:{shipID:201,systemID:30000144,initialStateSent:true},socket:{destroyed:false}};
 const p2={characterID:2,_space:{shipID:202,systemID:30000144,initialStateSent:true},socket:{destroyed:false}};
 const scene={systemID:30000144,sessions:new Map([["first",p1],["second",p2]]),getEntityByID:id=>ships.get(Number(id))};
 const attack={action:"attack",pirateID:100,targetID:101,targetRole:"hauler"};
 const warp={...attack,action:"warp-to-hauler"};
 const out=[];
 let time=500000;
 const director=createBroadcaster({clock:()=>time,send:(session,message)=>out.push({id:session.characterID,message}),locate:()=>({name:"Perimeter Asteroid Belt I"}),cooldownMs:240000,maxEntries:5});
 return {scene,p1,p2,ships,attack,warp,out,director,advance:n=>{time+=n;}};
}
test("two independent native pilots receive one actionable raid signal",()=>{
 const f=fixture();const result=f.director.notifyRaid(f.scene,[f.attack]);
 assert.equal(result.sent,2);
 assert.deepEqual(f.out.map(x=>x.id),[1,2]);
 assert.match(f.out[0].message,/Perimeter Asteroid Belt I/);
 assert.match(f.out[0].message,/атакує/);
 assert.equal(f.director.notifyRaid(f.scene,[f.attack]).sent,0);
});
test("new native approach and attack phases are distinct; attack takes priority",()=>{
 const f=fixture();
 assert.equal(f.director.notifyRaid(f.scene,[f.warp]).sent,2);
 assert.match(f.out[0].message,/лише наближення/);
 assert.equal(f.director.notifyRaid(f.scene,[f.warp,f.attack]).sent,2);
 assert.match(f.out.at(-1).message,/атакує/);
 assert.equal(f.director.notifyRaid(f.scene,[f.attack]).sent,0);
 f.advance(240001);
 assert.equal(f.director.notifyRaid(f.scene,[f.attack]).sent,2);
});
test("refuses phantom raid orders, nonship entities and invalid locations",()=>{
 const f=fixture();
 assert.equal(f.director.notifyRaid(f.scene,[{...f.attack,pirateID:999}]).sent,0);
 assert.equal(f.director.notifyRaid(f.scene,[{...f.attack,targetRole:"player"}]).sent,0);
 f.ships.get(100).kind="wreck";
 assert.equal(f.director.notifyRaid(f.scene,[f.attack]).sent,0);
 f.ships.get(100).kind="ship";f.ships.get(100).position.x=Infinity;
 assert.equal(f.director.notifyRaid(f.scene,[f.attack]).sent,0);
 assert.equal(f.out.length,0);
});
test("excludes ghost, unready, wrong-system, disconnected and duplicate sessions",()=>{
 const f=fixture();
 f.p1._space.initialStateSent=false;
 f.p2._space.systemID=30000142;
 assert.equal(f.director.notifyRaid(f.scene,[f.attack]).sent,0);
 f.p1._space.initialStateSent=true;f.p2._space.systemID=30000144;
 f.p2.socket.destroyed=true;
 assert.equal(f.director.notifyRaid(f.scene,[f.attack]).sent,1);
 f.p2.socket.destroyed=false;
 f.scene.sessions.set("duplicate",{...f.p2});
 assert.equal(f.director.notifyRaid(f.scene,[f.attack]).sent,1);
 f.ships.delete(201);
 f.advance(240001);
 assert.equal(f.director.notifyRaid(f.scene,[f.attack]).sent,1);
});
test("does not mark failed delivery as announced and does not invent a destination",()=>{
 const f=fixture();let fails=1,now=700000;const delivered=[];
 const b=createBroadcaster({clock:()=>now,send:(s,m)=>{if(fails-- > 0)throw Error("chat down");delivered.push({s,m});},locate:()=>{throw Error("topology unreadable");}});
 assert.equal(b.notifyRaid(f.scene,[f.attack]).sent,1);
 assert.match(delivered[0].m,/у цій системі/);
 assert.equal(b.notifyRaid(f.scene,[f.attack]).sent,1);
 assert.equal(b.notifyRaid(f.scene,[f.attack]).sent,0);
});
test("new real target gets a new signal, even while old target is on cooldown",()=>{
 const f=fixture();
 assert.equal(f.director.notifyRaid(f.scene,[f.attack]).sent,2);
 const another={...f.attack,targetID:102};
 assert.equal(f.director.notifyRaid(f.scene,[another]).sent,2);
});
test("invalid scene never attempts to broadcast",()=>{
 const f=fixture();
 assert.equal(f.director.notifyRaid(null,[f.attack]).sent,0);
 assert.equal(f.director.notifyRaid(f.scene,[]).sent,0);
 assert.equal(f.director.notifyRaid(f.scene,[{...f.attack,targetID:100}]).sent,0);
});
test("user-controlled waypoint name is sanitized before being shown in chat",()=>{
 const f=fixture(); const sent=[];
 const b=createBroadcaster({send:(_,m)=>sent.push(m),locate:()=>({name:"<script>\n  Asteroid > field"})});
 assert.equal(b.notifyRaid(f.scene,[f.attack]).sent,2);
 assert.doesNotMatch(sent[0],/[<>\n]/);
});
test("suppresses player-owned ship impersonation and obsolete approach after attack",()=>{
 const f=fixture();
 assert.equal(f.director.notifyRaid(f.scene,[{...f.attack,pirateID:201}]).sent,0);
 assert.equal(f.director.notifyRaid(f.scene,[{...f.attack,targetID:202}]).sent,0);
 assert.equal(f.director.notifyRaid(f.scene,[f.attack,f.warp]).sent,2);
 assert.equal(f.director.notifyRaid(f.scene,[f.attack,f.warp]).sent,0);
});
