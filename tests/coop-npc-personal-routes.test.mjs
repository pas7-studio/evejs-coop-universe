import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../integration/coopCivilianOrders.cjs',import.meta.url),'utf8');
function fixture(){
 const points=[{id:701,kind:'stargate',position:{x:360000,y:0,z:0}},
 {id:702,kind:'station',position:{x:420000,y:0,z:0}},
 {id:703,kind:'asteroidBelt',position:{x:320000,y:0,z:0}}];
 const ship={itemID:501,kind:'ship',nativeNpc:true,position:{x:0,y:0,z:0}};
 const scene={systemID:30000144,getEntityByID:id=>id===501?ship:null};
 const commands=[];let succeed=true;
 const m={exports:{}};
 vm.runInNewContext(code,{module:m,exports:m.exports,require:id=>{
  if(id==='./coopNpcTopology')return {waypoints:()=>points};
  if(id==='./npc/npcRegistry')return {getControllerByEntityID:()=>({entityID:501,systemID:30000144,currentTargetID:0})};
  throw Error('Unexpected dependency: '+id);
 }},{filename:'coopCivilianOrders.cjs'});
 const director=m.exports.createCivilianOrders({sceneForSystem:()=>scene,
  warp:(id,point,options)=>{commands.push(options.targetEntityID);return {success:succeed};},
  orbit:(id,target)=>{commands.push(target);return {success:succeed};}});
 const tick=override=>director.tick([{pilotID:'coop-pilot-003',systemID:30000144,entityID:501}],
  {'coop-pilot-003':{role:'pirate'}},
  {routeOverrides:override?{'coop-pilot-003':override}:{}});
 return {tick,ship,points,commands,scene,director,fail:()=>{succeed=false}};
}
test('actual native warp target differs by personal scout/watch/lay-low goal',()=>{
 for(const [goal,target] of [['scout',701],['watch',703],['lay-low',702]]){
  const f=fixture(),orders=f.tick(goal);
  assert.equal(orders.length,1);
  assert.equal(f.commands[0],target);
  assert.equal(orders[0].targetID,target);
  assert.equal(orders[0].action,'warp');
 }
});
test('legacy pirate route is preserved when override disabled',()=>{
 const f=fixture();assert.equal(f.tick()[0].targetID,701);
});
test('switching personal intentions resets navigation goal even during dwell',()=>{
 const f=fixture();f.tick('scout');f.tick('watch');assert.deepEqual(f.commands,[701,703]);
});
test('no real station prevents invented lay-low waypoint',()=>{
 const f=fixture();f.points.splice(1,1);
 assert.equal(f.tick('lay-low').length,0);assert.equal(f.commands.length,0);
});
test('native warp failure creates no successful travel record',()=>{
 const f=fixture();f.fail();assert.equal(f.tick('watch').length,0);
 assert.equal(f.commands[0],703);
});
test('warp in progress and invalid position stop repeated native routing',()=>{
 const f=fixture();f.ship.mode='WARP';assert.equal(f.tick('scout').length,0);
 f.ship.mode='IDLE';f.ship.position={x:NaN,y:0,z:0};assert.equal(f.tick('scout').length,0);
 assert.equal(f.commands.length,0);
});
