import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const {createWorld}=require('../integration/coopVirtualWorld.cjs');
function fixture(fn){
 const dir=mkdtempSync(join(tmpdir(),'coop-world-'));
 try{fn(join(dir,'world.json'));}finally{rmSync(dir,{recursive:true,force:true});}
}
test('virtual pilots travel across systems and survive a full restart',()=>fixture(file=>{
 let now=1000;
 const options={file,route:[30000142,30000144,30000145],population:4,travelMs:10000,clock:()=>now};
 const a=createWorld(options);
 assert.equal(a.snapshot().pilots.length,4);
 const before=a.snapshot();
 now+=30000;
 assert.ok(a.advance().moves>0);
 const b=createWorld(options);
 assert.deepEqual(b.snapshot(),a.snapshot());
 assert.notDeepEqual(a.snapshot().pilots,before.pilots);
 assert.equal(b.snapshot().pilots.reduce((n,p)=>n+(p.systemID===30000142||p.systemID===30000144||p.systemID===30000145?1:0),0),4);
}));
test('virtual catch-up on restart handles elapsed time without spawning anything',()=>fixture(file=>{
 let now=1000;
 const options={file,route:[30000142,30000144],population:1,travelMs:10000,clock:()=>now};
 createWorld(options);
 now=1000+10000*1000;
 const b=createWorld(options);
 assert.equal(b.advance().moves,1000);
 assert.equal(b.snapshot().pilots[0].journeys,1000);
}));
test('population cap and route validation reject unsafe configuration',()=>fixture(file=>{
 assert.throws(()=>createWorld({file,route:[30000142],population:1}),/valid route/);
 assert.throws(()=>createWorld({file,route:[30000142,30000144],population:101}),/population cap/);
}));

test('saved Living Universe grows from 16 to 20 identities without deleting prior pilot history',()=>fixture(file=>{
 let now=1000;const clock=()=>now,route=[30000142,30000144];
 const world=createWorld({file,route,population:16,travelMs:10000,clock});
 const original=world.snapshot().pilots.map(p=>({id:p.id,name:p.name}));
 now+=30000;world.advance();
 const upgraded=createWorld({file,route,population:20,travelMs:10000,clock});
 assert.equal(upgraded.snapshot().pilots.length,20);
 for(let i=0;i<16;i++){assert.equal(upgraded.snapshot().pilots[i].id,original[i].id);assert.equal(upgraded.snapshot().pilots[i].name,original[i].name);}
 assert.equal(new Set(upgraded.snapshot().pilots.map(p=>p.id)).size,20);
}));
test('a real native NPC ship pins its virtual pilot to the physical system',()=>fixture(file=>{
 let now=1000;
 const world=createWorld({file,route:[30000142,30000144],population:2,travelMs:10000,clock:()=>now});
 now+=100000;
 world.advance({'coop-pilot-001':30000142});
 const pilot=world.snapshot().pilots.find(p=>p.id==='coop-pilot-001');
 assert.equal(pilot.systemID,30000142);
 assert.equal(pilot.nextMoveAt,now+10000);
}));

test('new LivingCoop two-system worlds have both factions in each system',()=>fixture(file=>{
 const world=createWorld({file,route:[30000142,30000144],population:20});
 const state=world.snapshot();
 assert.equal(state.factionLayoutVersion,2);
 for(const systemID of [30000142,30000144]){
  const factions=new Set(world.residents(systemID).map(p=>p.faction));
  assert.deepEqual([...factions].sort(),['frontier','independent']);
 }
}));
test('legacy faction migration is explicit, backed up and preserves NPC identity',()=>fixture(file=>{
 const route=[30000142,30000144],clock=()=>10000;
 const original={
  version:1,lastAdvancedAt:1000,pilots:Array.from({length:20},(_,i)=>({
   id:'coop-pilot-'+String(i+1).padStart(3,'0'),name:'Named '+i,
   faction:i%2?'frontier':'independent',systemID:route[i%2],
   routeIndex:i%2,nextMoveAt:20000,journeys:i*4
  }))
 };
 writeFileSync(file,JSON.stringify(original));
 const options={file,route,population:20,clock};
 assert.deepEqual(createWorld(options).snapshot(),original);
 const migrated=createWorld({...options,migrateFactions:true}).snapshot();
 assert.equal(migrated.factionLayoutVersion,2);
 assert.equal(existsSync(file+'.pre-faction-layout-v2.bak'),true);
 assert.deepEqual(JSON.parse(readFileSync(file+'.pre-faction-layout-v2.bak','utf8')),original);
 assert.deepEqual(migrated.pilots.map(p=>[p.id,p.name,p.journeys]),
  original.pilots.map(p=>[p.id,p.name,p.journeys]));
 assert.equal(new Set(migrated.pilots.filter(p=>p.systemID===route[0]).map(p=>p.faction)).size,2);
 assert.equal(new Set(migrated.pilots.filter(p=>p.systemID===route[1]).map(p=>p.faction)).size,2);
 assert.deepEqual(createWorld({...options,migrateFactions:true}).snapshot(),migrated);
}));
