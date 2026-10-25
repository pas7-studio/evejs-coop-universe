import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {DatabaseSync} from "node:sqlite";

const require=createRequire(import.meta.url);
const {createAtomicAmmoBank,inspectShip}=require("../integration/coopNpcAmmoBankAtomic.cjs");
const SEP="\u001f";
function seed(db){
 for(const t of ["npcEntities","npcModules","npcCargo"])
  db.exec('CREATE TABLE "'+t+'"(key TEXT PRIMARY KEY,json TEXT NOT NULL)');
 const put=(t,k,v)=>db.prepare(
  'INSERT INTO "'+t+'"(key,json) VALUES(?,?)').run(k,JSON.stringify(v));
 put("npcEntities","entities"+SEP+"101",{entityID:101,ownerID:900,systemID:30000144});
 for(const [moduleID,flagID] of [[401,27],[402,28]])
  put("npcModules","modules"+SEP+moduleID,
   {moduleID,entityID:101,ownerID:900,typeID:123,categoryID:7,flagID});
 const cargo={};
 for(const [cargoID,moduleID,flagID] of [[501,401,27],[502,402,28]])
  cargo[cargoID]={cargoID,entityID:101,moduleID,ownerID:900,
   typeID:35,categoryID:8,flagID,quantity:5};
 put("npcCargo","cargo",cargo);
}
function openAdapter(db){
 return {transact(tables,fn){
  db.exec("BEGIN IMMEDIATE");
  try{
   const tx={
    get(t,k){if(!tables.includes(t))throw Error("UNDISCLOSED_TABLE");
     const row=db.prepare('SELECT json FROM "'+t+'" WHERE key=?').get(k);
     return row?JSON.parse(row.json):null;},
    put(t,k,val){if(!tables.includes(t))throw Error("UNDISCLOSED_TABLE");
     db.prepare('INSERT INTO "'+t+'"(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json')
      .run(k,JSON.stringify(val));}
   };
   const result=fn(tx);
   db.exec("COMMIT");
   return result;
  }catch(e){try{db.exec("ROLLBACK");}catch(_){}throw e;}
 }};
}
function loadCargo(db){
 const row=db.prepare('SELECT json FROM "npcCargo" WHERE key=?').get("cargo");
 return row?JSON.parse(row.json):{};
}
const ship={kind:"ship",nativeNpc:true,itemID:101,ownerID:900,
 nativeCargoItems:[{itemID:501,quantity:5},{itemID:502,quantity:5}]};
const entries=[
 {moduleItem:{itemID:401,typeID:123,flagID:27},
  chargeItem:{itemID:501,typeID:35,quantity:5}},
 {moduleItem:{itemID:402,typeID:123,flagID:28},
  chargeItem:{itemID:502,typeID:35,quantity:5}}
];
function tryFire(root,db,faultProbe=null){
 return createAtomicAmmoBank({
  root:path.join(root,"journal"),atomicRows:openAdapter(db),
  compatible:()=>true,clock:()=>1000000,
  store:{listNativeCargoForEntity:()=>Object.values(loadCargo(db))},
  faultProbe
 }).consume({entity:structuredClone(ship),entries:structuredClone(entries),whenMs:1000});
}
function child(root,at){
 fs.mkdirSync(path.join(root,"journal"));
 const db=new DatabaseSync(path.join(root,"native.sqlite"));
 seed(db);
 // Kill the real Linux process at the exact code boundary. The test parent
 // must not kill a production game server or touch any existing data directory.
 const result=tryFire(root,db,phase=>{
  if(phase===at)process.kill(process.pid,"SIGKILL");
 });
 db.close();
 process.stderr.write("TEST_CHILD_NOT_KILLED:"+result.errorMsg);
 process.exit(99);
}
if(process.argv[2]==="--child")child(process.argv[3],process.argv[4]);
function check(at,expected){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"coop-bank-sqlite-crash-"));
 let db;
 try{
  const run=spawnSync(process.execPath,[fileURLToPath(import.meta.url),"--child",root,at],
   {timeout:10000,encoding:"utf8",env:{...process.env}});
  assert.equal(run.signal,"SIGKILL",run.stderr||String(run.error));
  db=new DatabaseSync(path.join(root,"native.sqlite"));
  const cargo=loadCargo(db);
  assert.equal(cargo["501"].quantity,expected);
  assert.equal(cargo["502"].quantity,expected);
  const receipt=inspectShip({root:path.join(root,"journal"),entityID:101});
  assert.equal(receipt.ok,false);
  assert.equal(receipt.status,"BANK_LOCKED_RECONCILE");
  const retry=tryFire(root,db);
  assert.equal(retry.success,false);
  assert.equal(retry.errorMsg,"BANK_ATOMIC_JOURNAL_UNSAFE");
  assert.equal(loadCargo(db)["501"].quantity,expected);
  assert.equal(loadCargo(db)["502"].quantity,expected);
 }finally{
  if(db)db.close();
  fs.rmSync(root,{recursive:true,force:true});
 }
}
test("Linux SIGKILL after fsynced PREPARED leaves all native ammo unspent and blocks restart replay",{
 skip:process.platform!=="linux"
},()=>check("after-prepared",5));
test("Linux SIGKILL after SQLite COMMIT keeps all ammo spent, with retry blocked by PREPARED",{
 skip:process.platform!=="linux"
},()=>check("after-sqlite-commit",4));
