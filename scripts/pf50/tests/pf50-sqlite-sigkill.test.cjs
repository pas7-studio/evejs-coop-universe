'use strict';
// Disposal-only crash fixture. Never opens production game DBs.
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const WORKER=String.raw`
const {DatabaseSync}=require('node:sqlite');
const [file,kind]=process.argv.slice(1);
const db=new DatabaseSync(file); db.exec('PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL');
if(kind==='permit'){
 db.exec('BEGIN IMMEDIATE');
 db.prepare('INSERT INTO corporationRuntime(key,json) VALUES(?,?)').run('pf50-operation','{"status":"PENDING","operationID":"pf-haul:123"}');
 db.exec('COMMIT');
}else if(kind==='settlement'){
 db.exec('BEGIN IMMEDIATE');
 db.prepare('UPDATE npcCargo SET json=? WHERE key=?').run('{"cargo":{"7001":{"entityID":66002,"quantity":8}}}','cargo');
 db.prepare('INSERT INTO npcCargo(key,json) VALUES(?,?)').run('coopNativeHaulTransfer:7001','{"status":"COMMITTED","cargoID":7001}');
 db.exec('COMMIT');
}else{throw Error('INVALID_WORKER_KIND')}
process.stdout.write('DURABLE_COMMIT_COMPLETE\n');
process.stdin.resume();
`;
function create(file){const db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL');
 for(const t of ['corporationRuntime','npcCargo'])db.exec(`CREATE TABLE ${t}(key TEXT PRIMARY KEY,json TEXT NOT NULL)`);
 db.prepare('INSERT INTO npcCargo(key,json) VALUES(?,?)').run('cargo','{"cargo":{"7001":{"entityID":66001,"quantity":8}}}');
 db.close();}
function read(db,table,key){const r=db.prepare(`SELECT json FROM ${table} WHERE key=?`).get(key);return r?JSON.parse(r.json):null}
async function killAfterCommit(file,kind){
 return new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,['-e',WORKER,file,kind],{stdio:['pipe','pipe','pipe']});
 let saw=false,err='',output='';
 child.stderr.on('data',b=>err+=String(b));
 child.stdout.on('data',b=>{output+=String(b);if(output.includes('DURABLE_COMMIT_COMPLETE')&&!saw){saw=true;child.kill('SIGKILL');}});
 child.on('error',reject);
 child.on('close',(code,signal)=>{
  if(!saw)return reject(Error('CHILD_DID_NOT_ACK_DURABLE_COMMIT '+err));
  if(signal!=='SIGKILL')return reject(Error('CHILD_NOT_SIGKILLED '+signal+' '+code));
  resolve();
 });
 });
}
const skip=process.platform==='win32'?'SIGKILL Unix fixture only':false;
test('SIGKILL after durable PF50 PENDING permit keeps original cargo unchanged', {skip},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pf50-sigkill-')),file=path.join(root,'test.db');
 try{create(file);await killAfterCommit(file,'permit');const db=new DatabaseSync(file);
  assert.equal(read(db,'corporationRuntime','pf50-operation').status,'PENDING');
  assert.equal(read(db,'npcCargo','cargo').cargo['7001'].entityID,66001);
  assert.equal(read(db,'npcCargo','coopNativeHaulTransfer:7001'),null);db.close();
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('SIGKILL after original cargo receipt, before permit ACK, preserves one cargo and original receipt', {skip},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pf50-sigkill-')),file=path.join(root,'test.db');
 try{create(file);await killAfterCommit(file,'permit');await killAfterCommit(file,'settlement');
  const db=new DatabaseSync(file);
  assert.equal(read(db,'corporationRuntime','pf50-operation').status,'PENDING');
  const cargo=read(db,'npcCargo','cargo').cargo;
  assert.deepEqual(Object.keys(cargo),['7001']);
  assert.equal(cargo['7001'].entityID,66002);assert.equal(cargo['7001'].quantity,8);
  assert.equal(read(db,'npcCargo','coopNativeHaulTransfer:7001').status,'COMMITTED');db.close();
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});