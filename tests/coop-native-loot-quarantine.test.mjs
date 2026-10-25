import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createGuard}=require("../integration/coopNativeLootQuarantine.cjs");
function makeStorage(){
 const files=new Map(),calls=[];
 const storage={
  readFileSync(file){
   if(!files.has(file)){const e=Error("ENOENT");e.code="ENOENT";throw e;}
   return files.get(file);
  },
  mkdirSync(){calls.push("mkdir");},
  writeFileSync(file,value,{flag}={}){
   calls.push("write");if(flag!=="wx")throw Error("Unsafe writer");
   if(files.has(file)){const e=Error("EEXIST");e.code="EEXIST";throw e;}
   files.set(file,value);
  },
  renameSync(oldPath,newPath){
   calls.push("rename");if(!files.has(oldPath))throw Error("Missing temp");
   files.set(newPath,files.get(oldPath));files.delete(oldPath);
  },
  unlinkSync(file){files.delete(file);}
 };
 return {files,calls,storage};
}
const request={wreckID:901,wreckItemID:7001,
 reason:"NATIVE_LOOT_SOURCE_NOT_REMOVED"};
test("quarantine blocks only one item, and survives a new guard instance",()=>{
 const {storage,files}=makeStorage();
 const g=createGuard({file:"/tmp/eve-quarantine.json",storage,clock:()=>111});
 assert.equal(g.check(request).status,"ALLOW");
 assert.equal(g.quarantine(request).status,"QUARANTINED");
 assert.equal(g.check(request).status,"QUARANTINED");
 assert.equal(g.check({...request,wreckItemID:7002}).status,"ALLOW");
 const restarted=createGuard({file:"/tmp/eve-quarantine.json",storage});
 assert.equal(restarted.check(request).status,"QUARANTINED");
 assert.equal(restarted.check({...request,wreckItemID:7002}).status,"ALLOW");
 assert.equal(JSON.parse(files.get("/tmp/eve-quarantine.json")).entries["901:7001"].createdAt,111);
});
test("idempotent repeated quarantine never overwrites the first record",()=>{
 const {storage,calls,files}=makeStorage();
 const guard=createGuard({file:"/tmp/eve-quarantine.json",storage,clock:()=>100});
 assert.equal(guard.quarantine(request).status,"QUARANTINED");
 assert.equal(guard.quarantine({...request,reason:"NATIVE_LOOT_SOURCE_NOT_DECREMENTED"}).status,
  "QUARANTINED");
 assert.deepEqual(calls,["mkdir","write","rename"]);
 assert.equal(JSON.parse(files.get("/tmp/eve-quarantine.json")).entries["901:7001"].reason,
  "NATIVE_LOOT_SOURCE_NOT_REMOVED");
});
test("corrupt persistent quarantine state blocks ALL loot, never silently resets",()=>{
 const {storage,files}=makeStorage();
 files.set("/tmp/eve-quarantine.json","{not valid JSON");
 const guard=createGuard({file:"/tmp/eve-quarantine.json",storage});
 assert.equal(guard.check(request).status,"QUARANTINE_STORAGE_UNSAFE");
 assert.equal(guard.check({...request,wreckItemID:7002}).status,"QUARANTINE_STORAGE_UNSAFE");
 assert.equal(guard.quarantine(request).status,"QUARANTINE_STORAGE_UNSAFE");
});
test("persistence failure blocks every further claim in the active process",()=>{
 const {storage}=makeStorage();
 storage.writeFileSync=()=>{throw Error("disk full");};
 const guard=createGuard({file:"/tmp/eve-quarantine.json",storage});
 assert.equal(guard.quarantine(request).status,"QUARANTINE_STORAGE_UNSAFE");
 assert.equal(guard.check({...request,wreckItemID:7002}).status,"QUARANTINE_STORAGE_UNSAFE");
});
test("invalid keys/reasons never write quarantine state",()=>{
 const {storage,calls}=makeStorage();
 const guard=createGuard({file:"/tmp/eve-quarantine.json",storage});
 assert.equal(guard.check({wreckID:0,wreckItemID:1}).status,"INVALID");
 assert.equal(guard.quarantine({...request,reason:"NETWORK_TIMEOUT"}).status,"INVALID");
 assert.deepEqual(calls,[]);
});
