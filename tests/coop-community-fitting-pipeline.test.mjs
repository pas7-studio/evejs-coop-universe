import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const cp=require('node:child_process');
const __dirname=path.dirname(require('node:url').fileURLToPath(import.meta.url));
const {fitHash}=require('../scripts/coop-community-fittings.cjs');
const script=p=>path.join(__dirname,'..','scripts',p);
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'coop043-pipeline-'));
 const sde=path.join(root,'sde');fs.mkdirSync(sde);
 fs.writeFileSync(path.join(sde,'types.jsonl'),[
  {_key:600,groupID:1,published:true,name:{en:'Merlin'}},
  {_key:201,groupID:2,published:true,name:{en:'Damage Control I'}},
  {_key:202,groupID:2,published:true,name:{en:'Shield Booster I'}},
  {_key:203,groupID:2,published:true,name:{en:'Light Missile Launcher I'}},
  {_key:204,groupID:2,published:true,name:{en:'Small Shield Extender I'}}
 ].map(x=>JSON.stringify(x)).join('\n'));
 fs.writeFileSync(path.join(sde,'groups.jsonl'),[{_key:1,categoryID:6},{_key:2,categoryID:7}].map(JSON.stringify).join('\n'));
 const cache=path.join(root,'cache');fs.mkdirSync(path.join(cache,'pages'),{recursive:true});fs.mkdirSync(path.join(cache,'eft'),{recursive:true});
 const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
 fs.writeFileSync(path.join(cache,'pages','1.json'),JSON.stringify({error:false,numberOfPages:1,currentPage:1,fits:ids.map((id,i)=>({id,shipId:600,name:'V'+i,characterName:'Author'+i}))}));
 const fits=[
  '[Merlin, PvE]\nDamage Control I\n\nShield Booster I\n\nLight Missile Launcher I',
  '[Merlin, PvP]\nDamage Control I\n\nSmall Shield Extender I\n\nLight Missile Launcher I',
  '[Merlin, Support]\nDamage Control I\n\nShield Booster I\n\nLight Missile Launcher I\nLight Missile Launcher I'
 ];
 for(let i=0;i<3;i++)fs.writeFileSync(path.join(cache,'eft',ids[i]+'.json'),JSON.stringify({error:false,eft:fits[i]}));
 return {root,sde,cache,ids};
}
test('runs public-workbench fixture end-to-end without network or game writes',()=>{
 const f=fixture();
 try{
  const out=path.join(f.root,'output.json');
  const p=cp.spawnSync(process.execPath,[script('coop-community-fit-workbench.cjs'),'--sde',f.sde,'--cache',f.cache,'--out',out,'--per-hull','5','--pages','3','--ships','Merlin'],{encoding:'utf8',timeout:10000});
  assert.equal(p.status,0,p.stdout+'\n'+p.stderr);
  const j=JSON.parse(fs.readFileSync(out));
  assert.equal(j.summary.fits,3);
  assert.equal(j.summary.withAtLeast3,1);
  assert.equal(j.records.every(x=>x.provenance.kind==='public-workbench'),true);
  assert.equal(j.records.every(x=>x.fitData.every(t=>Array.isArray(t)&&t.length===3)),true);
  assert.equal(j.summary.dogmaValidated,false);
  // The executable never manufactures a database or player modules.
  assert.equal(fs.existsSync(path.join(f.root,'gamestore.sqlite')),false);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('seed command refuses any missing db and unauthorized apply before importing game modules',()=>{
 const p=cp.spawnSync(process.execPath,[script('coop-community-fit-seed.cjs'),'--mode','apply','--sde','missing','--db','missing','--code-path','missing','--catalog','missing'],{encoding:'utf8'});
 assert.notEqual(p.status,0);
 assert.match(p.stderr,/REQUIRED_ON_APPLY/);
});