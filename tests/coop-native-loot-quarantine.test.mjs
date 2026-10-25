import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createGuard}=require("../integration/coopNativeLootQuarantine.cjs");
const item={wreckID:901,wreckItemID:7001,reason:"NATIVE_LOOT_SOURCE_NOT_REMOVED"};
function fixture(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"native-loot-q-"));
 try{return fn({dir,file:path.join(dir,"quarantine.json")});}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test("durably quarantines exact wreck item and survives restart",()=>fixture(({file})=>{
 const first=createGuard({file,clock:()=>111});
 assert.equal(first.check(item).status,"ALLOW");
 assert.equal(first.quarantine(item).status,"QUARANTINED");
 assert.equal(createGuard({file}).check(item).status,"QUARANTINED");
 assert.equal(createGuard({file}).check({...item,wreckItemID:7002}).status,"ALLOW");
 const state=JSON.parse(fs.readFileSync(file,"utf8"));
 assert.equal(state.entries["901:7001"].createdAt,111);
 assert.equal(fs.existsSync(file+".writer.lock"),false);
}));
test("idempotent writer retains the first quarantine reason",()=>fixture(({file})=>{
 const g=createGuard({file,clock:()=>100});
 assert.equal(g.quarantine(item).status,"QUARANTINED");
 assert.equal(createGuard({file}).quarantine({...item,reason:"NATIVE_LOOT_SOURCE_NOT_DECREMENTED"}).status,"QUARANTINED");
 assert.equal(JSON.parse(fs.readFileSync(file,"utf8")).entries["901:7001"].reason,item.reason);
}));
test("a second writer cannot overwrite an existing writer lock",()=>fixture(({file})=>{
 fs.writeFileSync(file+".writer.lock","unresolved");
 const guard=createGuard({file});
 assert.equal(guard.check(item).status,"QUARANTINE_WRITER_BUSY");
 assert.equal(guard.quarantine(item).status,"QUARANTINE_STORAGE_UNSAFE");
 assert.equal(guard.check({...item,wreckItemID:8001}).status,"QUARANTINE_STORAGE_UNSAFE");
 assert.equal(fs.readFileSync(file+".writer.lock","utf8"),"unresolved");
}));
test("a leftover transaction temp file blocks other claims and requires repair",()=>fixture(({file,dir})=>{
 fs.writeFileSync(file+".tmp-12345","unfinished");
 const guard=createGuard({file});
 assert.equal(guard.check(item).status,"QUARANTINE_STORAGE_UNSAFE");
 assert.equal(guard.quarantine(item).status,"QUARANTINE_STORAGE_UNSAFE");
 assert.deepEqual(fs.readdirSync(dir),["quarantine.json.tmp-12345"]);
}));
test("corrupt durable JSON stops every claim rather than clearing the file",()=>fixture(({file})=>{
 fs.writeFileSync(file,"{broken");
 const guard=createGuard({file});
 assert.equal(guard.check(item).status,"QUARANTINE_STORAGE_UNSAFE");
 assert.equal(guard.check({...item,wreckItemID:7}).status,"QUARANTINE_STORAGE_UNSAFE");
 assert.equal(fs.readFileSync(file,"utf8"),"{broken");
}));
test("failure before atomic rename leaves lock and intermediate file for reconciliation",()=>fixture(({file})=>{
 const storage={...fs,renameSync:()=>{throw Error("disk failure");}};
 const guard=createGuard({file,storage});
 assert.equal(guard.quarantine(item).status,"QUARANTINE_STORAGE_UNSAFE");
 assert.equal(fs.existsSync(file),false);
 assert.equal(fs.existsSync(file+".writer.lock"),true);
 assert.equal(createGuard({file}).check(item).status,"QUARANTINE_WRITER_BUSY");
}));
test("failed durable directory sync cannot claim quarantine success",()=>fixture(({file})=>{
 let count=0;
 const storage={...fs,fsyncSync:(fd)=>{count++;if(count===4)throw Error("fsync failure");return fs.fsyncSync(fd);}};
 const guard=createGuard({file,storage});
 assert.equal(guard.quarantine(item).status,"QUARANTINE_STORAGE_UNSAFE");
 assert.equal(fs.existsSync(file+".writer.lock"),true);
}));
test("simultaneous independent guard objects do not lose different items",()=>fixture(({file})=>{
 const a=createGuard({file}),b=createGuard({file});
 assert.equal(a.quarantine(item).status,"QUARANTINED");
 assert.equal(b.quarantine({...item,wreckItemID:7002}).status,"QUARANTINED");
 const state=JSON.parse(fs.readFileSync(file,"utf8"));
 assert.deepEqual(Object.keys(state.entries).sort(),["901:7001","901:7002"]);
}));
test("invalid inputs never create quarantine state",()=>fixture(({file})=>{
 const guard=createGuard({file});
 assert.equal(guard.check({wreckID:0,wreckItemID:1}).status,"INVALID");
 assert.equal(guard.quarantine({...item,reason:"UNKNOWN"}).status,"INVALID");
 assert.equal(fs.existsSync(file),false);
}));
test("relative quarantine storage is refused: lock must live on durable absolute path",()=>{
 assert.throws(()=>createGuard({file:"relative.json"}),/invalid native loot quarantine store/);
});
