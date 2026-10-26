import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createExpeditionCompetition}=require('../integration/coopNpcExpeditionCompetition.cjs');
const SYSTEM=30000142,SITE=401;
function fixture(options={}) {
 let now=1_000_000;
 const site={siteID:SITE,systemID:SYSTEM,targetID:'ABC-001',
  siteKind:'relic',instanceID:123,actualPosition:{x:0,y:0,z:0}};
 const ships=new Map([
  [21,{kind:'ship',itemID:21,systemID:SYSTEM,nativeNpc:true,position:{x:10000,y:0,z:0}}],
  [22,{kind:'ship',itemID:22,systemID:SYSTEM,nativeNpc:false,position:{x:20000,y:0,z:0}}]
 ]);
 let sessions=new Map([['p1',{characterID:42,_space:{shipID:22,systemID:SYSTEM,initialStateSent:true},socket:{destroyed:false}}]]);
 const scene={systemID:SYSTEM,getEntityByID:id=>ships.get(id),get sessions(){return sessions;}};
 const links=new Map([[21,{pilotID:'coop-pilot-001',entityID:21,systemID:SYSTEM,
  nativeControllerVerified:true,durableLinkVerified:true}]]);
 const create=()=>createExpeditionCompetition({
  resolveNativeSite:(system,id)=>system===SYSTEM&&id===site.siteID?{...site}:null,
  resolveNativeNpcPilot:(system,id)=>links.get(id),
  clock:()=>now,...options});
 return {create,site,ships,links,scene,setNow:n=>{now=n;},
  advance:ms=>{now+=ms;},setSessions:s=>{sessions=s;}};
}
test('NPC on-grid survey is native-verified and never grants loot or bookmarks',()=>{
 const f=fixture(),r=f.create();
 const out=r.observe({scene:f.scene,siteID:SITE,shipID:21});
 assert.equal(out.status,'NATIVE_SITE_OBSERVED');
 assert.equal(out.firstKind,'NPC');
 assert.equal(out.nativeMutation,false);
 assert.equal(out.itemsTransferred,0);
 assert.equal(JSON.stringify(out).includes('actualPosition'),false);
 assert.equal(r.plan({scene:f.scene,siteID:SITE,shipID:21}).kind,'SURVEY_SITE');
 assert.equal(r.plan({scene:f.scene,siteID:SITE,shipID:21}).nativeOrderIssued,false);
});
test('player arriving second makes site contested, not exclusively owned',()=>{
 const f=fixture(),r=f.create();
 r.observe({scene:f.scene,siteID:SITE,shipID:21});f.advance(30);
 const p=r.observe({scene:f.scene,siteID:SITE,shipID:22});
 assert.equal(p.contested,true);assert.equal(p.firstKind,'NPC');
 assert.equal(r.plan({scene:f.scene,siteID:SITE,shipID:21}).kind,'OBSERVE_RIVAL');
 assert.equal(r.inspect({systemID:SYSTEM,siteID:SITE}).playerCharacters.length,1);
});
test('player can arrive first and NPC becomes rival',()=>{
 const f=fixture(),r=f.create();
 r.observe({scene:f.scene,siteID:SITE,shipID:22});f.advance(50);
 const n=r.observe({scene:f.scene,siteID:SITE,shipID:21});
 assert.equal(n.contested,true);assert.equal(n.firstKind,'PLAYER');
});
test('second observation from the same pilot is idempotent',()=>{
 const f=fixture(),r=f.create();
 r.observe({scene:f.scene,siteID:SITE,shipID:21});
 assert.equal(r.observe({scene:f.scene,siteID:SITE,shipID:21}).status,'ALREADY_OBSERVED');
 assert.equal(r.inspect({systemID:SYSTEM,siteID:SITE}).npcPilots.length,1);
});
test('NPC with no verified durable link or controller cannot discover',()=>{
 const f=fixture(),r=f.create();f.links.get(21).durableLinkVerified=false;
 assert.equal(r.observe({scene:f.scene,siteID:SITE,shipID:21}).status,'ACTOR_AUTHORITY_UNAVAILABLE');
 assert.equal(r.inspect({systemID:SYSTEM,siteID:SITE}),null);
});
test('fake NPC native flag on a real connected player is denied',()=>{
 const f=fixture(),r=f.create();f.ships.get(22).nativeNpc=true;
 assert.equal(r.observe({scene:f.scene,siteID:SITE,shipID:22}).status,'ACTOR_AUTHORITY_UNAVAILABLE');
});
test('duplicated player sessions cannot both claim the same ship',()=>{
 const f=fixture(),r=f.create();
 f.setSessions(new Map([['a',{characterID:42,_space:{shipID:22,systemID:SYSTEM,initialStateSent:true}}],
  ['b',{characterID:43,_space:{shipID:22,systemID:SYSTEM,initialStateSent:true}}]]));
 assert.equal(r.observe({scene:f.scene,siteID:SITE,shipID:22}).status,'ACTOR_AUTHORITY_UNAVAILABLE');
});
test('remote NPC, warping NPC and transient NPC cannot reveal a hidden site',()=>{
 const f=fixture(),r=f.create();
 f.ships.get(21).position.x=400000;
 assert.equal(r.observe({scene:f.scene,siteID:SITE,shipID:21}).status,'NO_NATIVE_ON_GRID_SHIP');
 f.ships.get(21).position.x=1;f.ships.get(21).pendingWarp={};
 assert.equal(r.observe({scene:f.scene,siteID:SITE,shipID:21}).status,'NO_NATIVE_ON_GRID_SHIP');
 f.ships.get(21).pendingWarp=null;f.ships.get(21).transient=true;
 assert.equal(r.observe({scene:f.scene,siteID:SITE,shipID:21}).status,'NO_NATIVE_ON_GRID_SHIP');
});
test('recycled site id with moved coordinates invalidates prior observation',()=>{
 const f=fixture(),r=f.create();
 r.observe({scene:f.scene,siteID:SITE,shipID:21});
 f.site.actualPosition.x=600000;
 assert.equal(r.plan({scene:f.scene,siteID:SITE,shipID:21}).status,'NPC_SURVEY_PROOF_REQUIRED');
 f.ships.get(21).position.x=600000;
 assert.equal(r.plan({scene:f.scene,siteID:SITE,shipID:21}).status,'NPC_SITE_NOT_OBSERVED');
 const next=r.observe({scene:f.scene,siteID:SITE,shipID:21});
 assert.equal(next.status,'NATIVE_SITE_OBSERVED');
 assert.equal(r.inspect({systemID:SYSTEM,siteID:SITE}).firstPlayer,null);
});
test('cross-system site spoof and client-like catalog entry are rejected',()=>{
 const f=fixture(),r=f.create();f.site.systemID=30000143;
 assert.equal(r.observe({scene:f.scene,siteID:SITE,shipID:21}).status,'NATIVE_SITE_UNAVAILABLE');
 f.site.systemID=SYSTEM;f.site.actualPosition={x:NaN,y:0,z:0};
 assert.equal(r.observe({scene:f.scene,siteID:SITE,shipID:21}).status,'NATIVE_SITE_UNAVAILABLE');
});
test('site age limits stale intent; no right to native movement after expiry',()=>{
 const f=fixture({maxAgeMs:60000}),r=f.create();
 r.observe({scene:f.scene,siteID:SITE,shipID:21});f.advance(60000);
 assert.equal(r.plan({scene:f.scene,siteID:SITE,shipID:21}).status,'NPC_SITE_NOT_OBSERVED');
 assert.equal(r.inspect({systemID:SYSTEM,siteID:SITE}),null);
});
test('bounded observation cap refuses new site rather than mutating other state',()=>{
 const f=fixture({maxSites:1}),r=f.create();
 assert.equal(r.observe({scene:f.scene,siteID:SITE,shipID:21}).status,'NATIVE_SITE_OBSERVED');
 f.site.siteID=402;
 assert.equal(r.observe({scene:f.scene,siteID:402,shipID:21}).status,'EXPEDITION_OBSERVATION_CAP');
 assert.equal(r.inspect({systemID:SYSTEM,siteID:SITE}).npcPilots.length,1);
});
test('same-millisecond arrival preserves actual first observer, not NPC bias',()=>{
 const f=fixture(),r=f.create();
 r.observe({scene:f.scene,siteID:SITE,shipID:22});
 assert.equal(r.observe({scene:f.scene,siteID:SITE,shipID:21}).firstKind,'PLAYER');
});
