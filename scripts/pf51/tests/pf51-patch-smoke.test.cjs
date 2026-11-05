'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),fs=require('node:fs'),os=require('node:os'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
// These are exact source anchors inspected at Git blob 2162c82... . Native full
// source is not distributed in this orchestration repo (engine fork authority).
const fixture=`function createService({db,store,nativeService,ensureState,spawn,register,destroy=null,
  getFleets,auditStartupCargo=null,log=()=>{}}={}){
 function start({scene,fleetCount}={}){
  if(busy.has(systemID))return {status:"BLOCKED",reason:"ALIFE08_REENTRANT",slots:[]};
  busy.add(systemID);
  try{
   return {status:reports.some(x=>x.status==="NEEDS_OPERATOR_REPAIR")?
    "NEEDS_OPERATOR_REPAIR":"OK",systemID,slots:reports};
  }finally{busy.delete(systemID)}
 }
}
function start(args){
 const {scene,spawn,register,getFleets,ensureState,fleetCount,destroy}=args||{};
 const db=require("../gameStore"),store=require("./npc/nativeNpcStore");
}
`;
test('generator changes exactly four source anchors, leaving old paths default-off',()=>{
 const script=`import sys;sys.path.insert(0,${JSON.stringify(root)});import build_patch;p=build_patch.modify_source(${JSON.stringify(fixture)});assert p.count('PF51_TRUSTED_BINDINGS_NOT_INSTALLED')==1;assert p.count('PF51_NATIVE_EVIDENCE_UNPROVEN')==1;assert p.count('pf51Admission=startupFence.admit')==1;assert p.count('startupFence.finish')==1;print(p)`;
 const r=cp.spawnSync('python3',['-c',script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/PF51_/);
});
test('unified diff passes git apply --check on source-pinned fixture',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pf51-patch-'));
 try{
  fs.mkdirSync(path.join(dir,'Code/server/src/space'),{recursive:true});
  fs.writeFileSync(path.join(dir,'Code/server/src/space/coopNativeMiningFleetDurable.js'),fixture);
  cp.execFileSync('git',['init','-q'],{cwd:dir});
  const script=`import sys;sys.path.insert(0,${JSON.stringify(root)});import build_patch;from pathlib import Path;b=${JSON.stringify(fixture)};u=build_patch.modify_source(b);g=(Path(${JSON.stringify(root)})/'native'/'coopPersonalFleetMiningStartupFence.js').read_text();print(build_patch.make_patch(b,u,g),end='')`;
  const generated=cp.spawnSync('python3',['-c',script],{encoding:'utf8'});assert.equal(generated.status,0,generated.stderr);
  const patch=path.join(dir,'pf51.patch');fs.writeFileSync(patch,generated.stdout);
  cp.execFileSync('git',['apply','--check',patch],{cwd:dir});
  cp.execFileSync('git',['apply',patch],{cwd:dir});
  const content=fs.readFileSync(path.join(dir,'Code/server/src/space/coopNativeMiningFleetDurable.js'),'utf8');
  assert.match(content,/PF51_TRUSTED_NATIVE_ADMISSION_UNAVAILABLE/);
  assert.match(content,/PF51_TRUSTED_BINDINGS_NOT_INSTALLED/);
  assert.ok(fs.existsSync(path.join(dir,'Code/server/src/space/coopPersonalFleetMiningStartupFence.js')));
  cp.execFileSync('node',['--check',path.join(dir,'Code/server/src/space/coopPersonalFleetMiningStartupFence.js')]);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('builder refuses an unpinned or modified native fork source',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pf51-drift-'));
 try{
  fs.mkdirSync(path.join(dir,'Code/server/src/space'),{recursive:true});
  fs.writeFileSync(path.join(dir,'Code/server/src/space/coopNativeMiningFleetDurable.js'),fixture);
  const r=cp.spawnSync('python3',[path.join(root,'build_patch.py'),'--fork-root',dir],{encoding:'utf8'});
  assert.notEqual(r.status,0);assert.match(r.stderr+r.stdout,/PF51_FORK_SOURCE_DRIFT/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});