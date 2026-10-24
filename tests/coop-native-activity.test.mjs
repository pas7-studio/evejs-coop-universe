import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createActivity}=require('../integration/coopNativeActivity.cjs');
function setup(){
 let now=1000000,ore=0,target=null;
 const ship={itemID:17,kind:'ship',position:{x:10,y:10,z:10}};
 const victim={itemID:99,kind:'ship',position:{x:400,y:20,z:0}};
 const scene={getEntityByID:id=>id===17?ship:id===99?victim:null};
 const links=[{entityID:17,pilotID:'coop-pilot-001',role:'miner',systemID:30000142}];
 const monitor=createActivity({clock:()=>now});
 const sample=()=>monitor.sample({systemID:30000142,scene,links,
  getCargo:()=>[{moduleID:0,typeID:34,quantity:ore}],getController:()=>({currentTargetID:target})});
 return {sample,ship,links,scene,advance:(ms=30000)=>{now+=ms;},setOre:n=>{ore=n;},setTarget:n=>{target=n;}};
}
test('first sample never claims movement, mining or a native combat order',()=>{
 const a=setup(),s=a.sample();assert.equal(s.status,'SAMPLED');
 assert.equal(s.physicalNpcShips,1);assert.equal(s.observedMovement,0);
 assert.equal(s.oreGrowth,0);assert.equal(s.engagedNativeNpcs,0);
});
test('only physically changed EveJS coordinates count as movement',()=>{
 const a=setup();a.sample();a.advance();a.ship.position.x+=200;
 assert.equal(a.sample().observedMovement,1);
 assert.equal(a.sample().observedMovement,0);
});
test('only native ore inventory growth proves growth; cargo must be real',()=>{
 const a=setup();a.sample();a.setOre(40);a.advance();
 const result=a.sample();assert.equal(result.oreGrowth,1);assert.equal(result.loadedOreShips,1);
 a.advance();a.setOre(25);assert.equal(a.sample().oreGrowth,0);
});
test('native active target proves a controller order, not a hit or kill',()=>{
 const a=setup();a.sample();a.setTarget(99);a.advance();
 const r=a.sample();assert.equal(r.engagedNativeNpcs,1);
 assert.equal(r.evidence[0].nativeTargetID,99);
 a.setTarget(111);a.advance();assert.equal(a.sample().engagedNativeNpcs,0);
});
test('fake/foreign links and absent ships cannot claim activity',()=>{
 const a=setup();a.links[0].systemID=30000144;
 assert.equal(a.sample().physicalNpcShips,0);
 a.links[0].systemID=30000142;a.ship.kind='asteroid';
 assert.equal(a.sample().physicalNpcShips,0);
});
test('authenticated player ship cannot be mistaken for a named NPC after stale link',()=>{
 const a=setup();a.scene.sessions=new Map([[1,{characterID:42,_space:{shipID:17}}]]);
 assert.equal(a.sample().physicalNpcShips,0);
});
