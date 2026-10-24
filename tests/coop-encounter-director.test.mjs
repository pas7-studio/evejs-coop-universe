import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const {createDirector}=require('../integration/coopEncounterDirector.cjs');
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'evejs-encounter-'));
 const filename=join(dir,'state','encounters.json');
 let now=1000000,called=0;
 const build=(spawn=()=>({success:true,data:{spawned:[{entity:{itemID:8901}}]}}))=>
  createDirector({filename,clock:()=>now,allowedSystems:[30000142],cooldownMs:60000,maxSpawns:2,
    spawn:id=>{called++;return spawn(id);}});
 return {filename,build,advance:ms=>now+=ms,calls:()=>called,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
test('durable encounter survives new director instance and respects cooldown',()=>{
 const f=fixture();try{
  const a=f.build();
  assert.equal(a.onPilotArrived(30000142).status,'SPAWNED');
  assert.equal(f.build().onPilotArrived(30000142).status,'COOLDOWN');
  assert.equal(f.calls(),1);
  f.advance(60000);
  assert.equal(f.build().onPilotArrived(30000142).status,'SPAWNED');
  f.advance(60000);
  assert.equal(f.build().onPilotArrived(30000142).status,'SPAWN_CAP');
  assert.equal(f.calls(),2);
  assert.equal(JSON.parse(readFileSync(f.filename)).systems['30000142'].spawns,2);
 }finally{f.cleanup();}
});
test('disallowed system does not spawn or create files',()=>{
 const f=fixture();try{assert.equal(f.build().onPilotArrived(30000144).status,'SKIP_SYSTEM');assert.equal(f.calls(),0);}finally{f.cleanup();}
});
test('failed native spawn is cooldown-limited, not retried on every login',()=>{
 const f=fixture();try{
  const d=f.build(()=>({success:false,errorMsg:'NO_POOL'}));
  assert.equal(d.onPilotArrived(30000142).status,'SPAWN_FAILED');
  assert.equal(f.build().onPilotArrived(30000142).status,'COOLDOWN');
  assert.equal(f.calls(),1);
 }finally{f.cleanup();}
});
test('invalid settings cannot create unbounded NPC batches',()=>{
 const f=fixture();try{
  assert.throws(()=>createDirector({filename:f.filename,spawn:()=>({success:true}),cooldownMs:0}),/minimum cooldown/);
  assert.throws(()=>createDirector({filename:f.filename,spawn:()=>({success:true}),maxSpawns:1001}),/invalid spawn cap/);
 }finally{f.cleanup();}
});

test('daily encounter cap renews without erasing lifetime kills or restarting game server',()=>{
 const f=fixture();try{
  const first=f.build();
  assert.equal(first.onPilotArrived(30000142).status,'SPAWNED');
  f.advance(60000);
  assert.equal(first.onPilotArrived(30000142).status,'SPAWNED');
  f.advance(60000);
  assert.equal(first.onPilotArrived(30000142).status,'SPAWN_CAP');
  f.advance(86400000);
  const afterDay=f.build();
  const result=afterDay.onPilotArrived(30000142);
  assert.equal(result.status,'SPAWNED');
  assert.equal(result.spawns,1);
  assert.equal(result.totalSpawns,3);
 }finally{f.cleanup();}
});
