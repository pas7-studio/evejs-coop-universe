// Co-op projection contract against EveJS's actual movementProjection module.
// Projection is used for Destiny presentation; the movement callback is a
// controlled deterministic fixture, NOT the full upstream movement engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const root=process.env.EVEJS_CODE_PATH;
if(!root)throw Error('EVEJS_CODE_PATH required');
const require=createRequire(import.meta.url);
const {projectEntityForDestinyStamp,rebuildKinematicUpdatesForProjectedStamp}=require(resolve(root,'server/src/space/movement/movementProjection.js'));
const entity=(id,pos,vel)=>({itemID:id,kind:'ship',position:{...pos},velocity:{...vel},mode:'GOTO',targetPoint:null,sessionlessWarpIngress:null});
function advance(ship,_scene,seconds){for(const axis of ['x','y','z'])ship.position[axis]+=ship.velocity[axis]*seconds;}
const clone=(ship)=>structuredClone(ship);
const project=(ship,stamp,now=1000)=>projectEntityForDestinyStamp({entity:ship,rawNowMs:now,stamp,advanceMovement:advance,cloneDynamicEntityForDestinyPresentation:clone});
test('two distinct ships project independently at same Destiny stamp without mutating authority',()=>{
  const a=entity(8001,{x:0,y:0,z:0},{x:100,y:0,z:0});
  const b=entity(8002,{x:3000,y:0,z:0},{x:-40,y:20,z:0});
  const pA=project(a,5),pB=project(b,5);
  assert.deepEqual(pA.position,{x:400,y:0,z:0});
  assert.deepEqual(pB.position,{x:2840,y:80,z:0});
  assert.deepEqual(a.position,{x:0,y:0,z:0});
  assert.deepEqual(b.position,{x:3000,y:0,z:0});
  assert.notEqual(pA,pB);assert.notEqual(pA,a);assert.notEqual(pB,b);
});
test('distinct Destiny stamps produce monotonic positions without applying projection twice',()=>{
  const a=entity(8001,{x:10,y:0,z:0},{x:15,y:0,z:0});
  assert.equal(project(a,2).position.x,25);
  assert.equal(project(a,4).position.x,55);
  assert.equal(project(a,4).position.x,55);
  assert.equal(a.position.x,10);
});
test('warp ingress must not be projected ahead',()=>{
  const a=entity(8001,{x:10,y:0,z:0},{x:200,y:0,z:0});
  a.sessionlessWarpIngress={phase:'INCOMING'};
  assert.deepEqual(project(a,10).position,{x:10,y:0,z:0});
});
test('missing projection dependencies return authoritative entity unchanged',()=>{
  const a=entity(8001,{x:10,y:0,z:0},{x:0,y:0,z:0});
  assert.equal(projectEntityForDestinyStamp({entity:a}),a);
});

test('two separate ships receive distinct projected velocity payloads, with unrelated updates unchanged',()=>{
  const a=entity(8001,{x:0,y:0,z:0},{x:100,y:0,z:0});
  const b=entity(8002,{x:1000,y:0,z:0},{x:-25,y:0,z:0});
  const updates=[
    {stamp:5,payload:['SetBallVelocity',[8001,{x:0,y:0,z:0}]]},
    {stamp:5,payload:['SetBallVelocity',[8002,{x:0,y:0,z:0}]]},
  ];
  const destiny={buildSetBallVelocityPayload:(id,v)=>['SetBallVelocity',[id,{...v}]]};
  const args={updates,rawNowMs:1000,scene:{},advanceMovement:advance,cloneDynamicEntityForDestinyPresentation:clone,destiny};
  const afterA=rebuildKinematicUpdatesForProjectedStamp({...args,entity:a});
  assert.deepEqual(afterA[0].payload,['SetBallVelocity',[8001,{x:100,y:0,z:0}]]);
  assert.strictEqual(afterA[1],updates[1], 'ship B update not rewritten while processing A');
  const afterB=rebuildKinematicUpdatesForProjectedStamp({...args,updates:afterA,entity:b});
  assert.deepEqual(afterB[1].payload,['SetBallVelocity',[8002,{x:-25,y:0,z:0}]]);
  assert.deepEqual(afterB[0].payload,afterA[0].payload);
  assert.deepEqual(updates[0].payload,['SetBallVelocity',[8001,{x:0,y:0,z:0}]]);
});
