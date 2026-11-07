'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const F=require('./fixture.cjs');
const linuxCrashTest=process.platform==='win32'?test.skip:test;
const fixture=require.resolve('./fixture.cjs');
function setup(mode){const tmp=F.tempDb(),f=F.open(tmp.file);
 if(mode==='dismiss')f.prepareContracted();else if(mode==='loss')f.prepareActive();else{f.seed();f.onboard();}
 f.close();return tmp;}
function die(file,scenario){const source=`const F=require(${JSON.stringify(fixture)});\n`+
 `const f=F.open(process.argv[1]); const mode=process.argv[2];\n`+
 `if(mode==='salary-tx'||mode==='dismiss-tx'||mode==='loss-tx'){\n`+
 `if(mode==='loss-tx')f.lossWreck(); let n=0; f.shared.onTx=tx=>{const put=tx.put;tx.put=(t,k,v)=>{put(t,k,v);if(++n===2)process.kill(process.pid,'SIGKILL');};};\n`+
 `}\n`+
 `if(mode==='salary-after-commit')Object.defineProperty(f.shared,'notificationSuccess',{get(){process.kill(process.pid,'SIGKILL');}});\n`+
 `if(mode==='salary-tx'||mode==='salary-after-commit')f.life.salary(F.payrollCmd());\n`+
 `else if(mode==='dismiss-tx')f.life.dismiss(F.dismissCmd());\n`+
 `else if(mode==='loss-tx')f.life.loss(F.lossCmd());\n`+
 `else if(mode==='loss-after-commit'){f.lossWreck();const r=f.life.loss(F.lossCmd());if(r.status!=='APPLIED')throw Error(JSON.stringify(r));process.kill(process.pid,'SIGKILL');}\n`+
 `else throw Error('BAD_SCENARIO');\nprocess.exit(88);`;
 const x=spawnSync(process.execPath,['-e',source,file,scenario],{timeout:15000,encoding:'utf8'});
 assert.equal(x.signal,'SIGKILL',JSON.stringify({status:x.status,signal:x.signal,stderr:x.stderr?.slice(-1200)}));}
linuxCrashTest('PF57 real child SIGKILL during original salary transaction rolls back wallet + journal',()=>{
 const t=setup('salary');try{die(t.file,'salary-tx');const f=F.open(t.file);
  try{assert.equal(f.get('characters','characters')[F.OWNER].balance,3500);
   assert.equal(f.get('corporationRuntime',F.api.LEDGER),null);
   assert.equal(f.life.salary(F.payrollCmd()).status,'APPLIED');}
  finally{f.close();}}finally{t.cleanup();}
});
linuxCrashTest('PF57 real SIGKILL after salary COMMIT before wallet notification cannot double charge',()=>{
 const t=setup('salary');try{die(t.file,'salary-after-commit');const f=F.open(t.file);
  try{assert.equal(f.get('characters','characters')[F.OWNER].balance,3455);
   assert.equal(f.life.salary(F.payrollCmd()).status,'DUPLICATE');
   assert.equal(f.get('characters','characters')[F.OWNER].balance,3455);}
  finally{f.close();}}finally{t.cleanup();}
});
linuxCrashTest('PF57 real SIGKILL in dismissal transaction cannot orphan pilot in global index',()=>{
 const t=setup('dismiss');try{die(t.file,'dismiss-tx');const f=F.open(t.file);
  try{assert.ok(f.get('corporationRuntime',F.pf52.REGISTRY_KEY).pilots[F.PILOT]);
   assert.ok(f.get('corporationRuntime',F.pf52.ROSTER_PREFIX+F.OWNER).pilots[F.PILOT]);
   assert.equal(f.life.dismiss(F.dismissCmd()).status,'APPLIED');}
  finally{f.close();}}finally{t.cleanup();}
});
linuxCrashTest('PF57 real SIGKILL in loss transaction preserves claim, reservation and lost original item',()=>{
 const t=setup('loss');try{die(t.file,'loss-tx');const f=F.open(t.file);
  try{assert.ok(f.get('corporationRuntime',F.pf52.REGISTRY_KEY).ships[String(F.SHIP)]);
   assert.ok(f.get('corporationRuntime',F.api.CLAIMS).claims[String(F.SHIP)]);
   assert.equal(f.get('items','items')[String(F.SHIP)],undefined);
   assert.equal(f.life.loss(F.lossCmd()).status,'APPLIED');}
  finally{f.close();}}finally{t.cleanup();}
});
linuxCrashTest('PF57 real SIGKILL after loss commit cannot release a second time or resurrect a ship',()=>{
 const t=setup('loss');try{die(t.file,'loss-after-commit');const f=F.open(t.file);
  try{assert.equal(f.life.loss(F.lossCmd()).status,'DUPLICATE');
   assert.equal(f.get('items','items')[String(F.SHIP)],undefined);
   assert.equal(f.get('corporationRuntime',F.pf52.REGISTRY_KEY).ships[String(F.SHIP)],undefined);}
  finally{f.close();}}finally{t.cleanup();}
});
