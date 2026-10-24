import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
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
