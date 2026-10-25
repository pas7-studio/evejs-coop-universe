import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeJobSelection}=require("../integration/coopNativeJobAgentSelection.cjs");
const EVENT="convoy-30000144-77-123",OTHER="convoy-30000144-77-124";
function withSelection(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-native-agent-selection-"));
 let now=100000;
 const make=()=>createNativeJobSelection({root,clock:()=>now});
 try{fn({root,make,advance:x=>now=x})}
 finally{fs.rmSync(root,{recursive:true,force:true})}
}
test("explicit native agent open pins authentic immutable event to actor",()=>withSelection(f=>{
 const s=f.make();const r=s.pin(701,500003,EVENT,105000);
 assert.equal(r.status,"SELECTED");
 assert.equal(s.read(701,500003).eventID,EVENT);
}));
test("repeat same offer is idempotent on disk",()=>withSelection(f=>{
 const s=f.make();
 assert.equal(s.pin(701,500003,EVENT,105000).status,"SELECTED");
 assert.equal(f.make().pin(701,500003,EVENT,105000).status,"SELECTED");
}));
test("cannot silently switch selected job for another real convoy",()=>withSelection(f=>{
 const s=f.make();s.pin(701,500003,EVENT,105000);
 assert.equal(f.make().pin(701,500003,OTHER,105000).status,"SELECTION_ALREADY_BOUND");
 assert.equal(f.make().read(701,500003).eventID,EVENT);
}));
test("a different character and agent never inherit another selection",()=>withSelection(f=>{
 const s=f.make();s.pin(701,500003,EVENT,105000);
 assert.equal(s.read(702,500003).status,"NOT_FOUND");
 assert.equal(s.read(701,500004).status,"NOT_FOUND");
}));
test("reject invalid event ID and missing actor before creating any record",()=>withSelection(f=>{
 const s=f.make();
 assert.equal(s.pin(701,500003,"../../foo",105000).status,"INVALID_SELECTION");
 assert.equal(s.pin(0,500003,EVENT,105000).status,"INVALID_SELECTION");
 assert.equal(s.read(-1,500003).status,"INVALID_ACTOR");
}));
test("expired job can be replaced ONLY by a new explicit native contact",()=>withSelection(f=>{
 const s=f.make();s.pin(701,500003,EVENT,105000);
 f.advance(105001);
 assert.equal(f.make().read(701,500003).status,"EXPIRED");
 assert.equal(f.make().pin(701,500003,OTHER,110000).status,"SELECTED");
 assert.equal(f.make().read(701,500003).eventID,OTHER);
}));
test("corrupted source on disk fails closed and cannot be overwritten",()=>withSelection(f=>{
 const s=f.make();s.pin(701,500003,EVENT,105000);
 const file=path.join(f.root,"coop-opportunities","native-agent-selections","701-500003.json");
 fs.writeFileSync(file,"{corrupt\n");
 assert.equal(f.make().read(701,500003).status,"SELECTION_CORRUPT");
 assert.equal(f.make().pin(701,500003,OTHER,105000).status,"SELECTION_CORRUPT");
}));
test("lost ACK and a stale temporary file never cause silent rebind",()=>withSelection(f=>{
 const s=f.make();s.pin(701,500003,EVENT,105000);
 f.advance(105001);
 const dir=path.join(f.root,"coop-opportunities","native-agent-selections");
 fs.writeFileSync(path.join(dir,"701-500003.json.tmp"),"old incomplete\n");
 assert.equal(f.make().pin(701,500003,OTHER,110000).status,
  "SELECTION_WRITE_UNCERTAIN_NEEDS_REPAIR");
 assert.equal(f.make().read(701,500003).eventID,EVENT);
}));
test("nonsensical future expiry cannot pin an unbounded job",()=>withSelection(f=>{
 const s=f.make();
 assert.equal(s.pin(701,500003,EVENT,100000+86400001).status,"INVALID_SELECTION");
 assert.equal(s.pin(701,500003,EVENT,100000).status,"INVALID_SELECTION");
}));
test("malformed selection record with mismatched authenticated actor fails closed",()=>withSelection(f=>{
 const s=f.make();s.pin(701,500003,EVENT,105000);
 const file=path.join(f.root,"coop-opportunities","native-agent-selections","701-500003.json");
 const row=JSON.parse(fs.readFileSync(file,"utf8"));row.characterID=702;
 fs.writeFileSync(file,JSON.stringify(row)+"\n");
 assert.equal(f.make().read(701,500003).status,"SELECTION_CORRUPT");
}));
test("separate read-only calls after restart preserve same pinned event",()=>withSelection(f=>{
 f.make().pin(701,500003,EVENT,105000);
 assert.equal(f.make().read(701,500003).eventID,EVENT);
 assert.equal(f.make().read(701,500003).eventID,EVENT);
}));
