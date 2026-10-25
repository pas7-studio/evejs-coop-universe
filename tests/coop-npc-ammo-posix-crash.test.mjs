import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";

const require=createRequire(import.meta.url);
const journalPath=fileURLToPath(new URL("../integration/coopNpcAmmoDebitJournal.cjs",import.meta.url));
const {createAmmoDebitJournal}=require(journalPath);
const linux=process.platform==="linux";
const args={
 entity:{kind:"ship",nativeNpc:true,itemID:101,ownerID:900},
 moduleItem:{itemID:401,flagID:27},
 chargeItem:{itemID:501,typeID:35,quantity:5},
 quantity:1,whenMs:1000
};
const store={
 getNativeEntity:()=>({entityID:101,ownerID:900,systemID:30000144}),
 listNativeCargoForEntity:()=>[{
  cargoID:501,entityID:101,moduleID:401,ownerID:900,
  typeID:35,flagID:27,categoryID:8,quantity:5
 }]
};
function temp(){return fs.mkdtempSync(path.join(os.tmpdir(),"coop-ammo-crash-"));}
function remove(root){fs.rmSync(root,{recursive:true,force:true});}

test("fresh Linux journal fsyncs ancestors before PREPARED and survives SIGKILL",{
 skip:!linux
},()=>{
 const root=temp();
 try{
  const child=`
   "use strict";
   const fs=require("node:fs");
   const path=require("node:path");
   const {createAmmoDebitJournal}=require(process.argv[1]);
   const root=process.argv[2];
   const calls=[];
   const original=fs.fsyncSync;
   fs.fsyncSync=function(fd){
    calls.push(fs.readlinkSync("/proc/self/fd/"+fd));
    return original(fd);
   };
   const store={
    getNativeEntity:()=>({entityID:101,ownerID:900,systemID:30000144}),
    listNativeCargoForEntity:()=>[{
     cargoID:501,entityID:101,moduleID:401,ownerID:900,
     typeID:35,flagID:27,categoryID:8,quantity:5
    }]
   };
   const journal=createAmmoDebitJournal({root,store,clock:()=>1000000});
   const begin=journal.begin({
    entity:{kind:"ship",nativeNpc:true,itemID:101,ownerID:900},
    moduleItem:{itemID:401,flagID:27},
    chargeItem:{itemID:501,typeID:35,quantity:5},
    quantity:1,whenMs:1000
   });
   if(!begin.ok){process.stderr.write(begin.status);process.exit(31);}
   fs.writeFileSync(path.join(root,"fsync-witness.json"),JSON.stringify(calls));
   process.kill(process.pid,"SIGKILL");
  `;
  const result=spawnSync(process.execPath,["-e",child,journalPath,root],{
   encoding:"utf8",timeout:8000
  });
  assert.equal(result.signal,"SIGKILL",result.stderr||result.error?.message);
  const calls=JSON.parse(fs.readFileSync(path.join(root,"fsync-witness.json"),"utf8"));
  const shipDir=path.join(root,"ships","101");
  assert.ok(calls.includes(root),"new ships entry must be fsynced in root");
  assert.ok(calls.includes(path.join(root,"ships")),"new ship entry must be fsynced in ships");
  assert.ok(calls.includes(shipDir),"PREPARED receipt must be fsynced in ship directory");
  const record=JSON.parse(fs.readFileSync(path.join(shipDir,"401.json"),"utf8"));
  assert.equal(record.phase,"PREPARED");
  assert.equal(record.beforeQuantity,5);
  assert.equal(record.afterQuantity,4);
  assert.ok(fs.existsSync(path.join(shipDir,"401.json.lock")));
  const recovered=createAmmoDebitJournal({root,store});
  assert.equal(recovered.begin({...args,whenMs:1100}).status,
   "NATIVE_AMMO_CYCLE_NEEDS_RECONCILIATION");
  assert.equal(store.listNativeCargoForEntity()[0].quantity,5);
 }finally{remove(root);}
});

test("missing persistent mount cannot be silently created by a first debit",()=>{
 const root=path.join(temp(),"unmounted");
 try{
  const journal=createAmmoDebitJournal({root,store});
  assert.equal(journal.begin(args).status,"NATIVE_AMMO_JOURNAL_UNSAFE");
  assert.equal(fs.existsSync(root),false);
 }finally{remove(path.dirname(root));}
});

test("symlinked ship journal directory cannot bypass the exclusive lock",{
 skip:!linux
},()=>{
 const root=temp(),elsewhere=temp();
 try{
  fs.mkdirSync(path.join(root,"ships"));
  fs.symlinkSync(elsewhere,path.join(root,"ships","101"),"dir");
  const journal=createAmmoDebitJournal({root,store});
  assert.equal(journal.begin(args).status,"NATIVE_AMMO_JOURNAL_UNSAFE");
  assert.equal(fs.existsSync(path.join(elsewhere,"401.json")),false);
  assert.equal(fs.existsSync(path.join(elsewhere,"401.json.lock")),false);
 }finally{remove(root);remove(elsewhere);}
});
