import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const modulePath=require.resolve("../integration/coopRuntimeProbe.cjs");
test("native PvE event boot ID is server-generated, not overridden and consistent across original receipts",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-pve-probe-"));
 const prior=process.env.EVEJS_COOP_EVENTS_FILE;
 const file=path.join(dir,"native-events.jsonl");
 process.env.EVEJS_COOP_EVENTS_FILE=file;
 try{
  delete require.cache[modulePath];
  const probe=require(modulePath);
  assert.equal(probe.observe("living-pve-native-boss-death",null,null,{
   runtimeRunID:"FORGED_PROCESS_ID",systemID:30000144}),true);
  assert.equal(probe.observe("living-pve-duo-native-reward-evidence",null,null,{
   runtimeRunID:"FORGED_PROCESS_ID",systemID:30000144}),true);
  const a=fs.readFileSync(file,"utf8").trim().split("\n").map(JSON.parse);
  assert.equal(a.length,2);
  assert.match(a[0].runtimeRunID,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
  assert.notEqual(a[0].runtimeRunID,"FORGED_PROCESS_ID");
  assert.equal(a[0].runtimeRunID,a[1].runtimeRunID);
  delete require.cache[modulePath];
  const rebooted=require(modulePath);
  assert.equal(rebooted.observe("living-pve-duo-native-mission-turnin",null,null),true);
  const c=JSON.parse(fs.readFileSync(file,"utf8").trim().split("\n")[2]);
  assert.notEqual(c.runtimeRunID,a[0].runtimeRunID);
 }finally{
  if(prior===undefined)delete process.env.EVEJS_COOP_EVENTS_FILE;
  else process.env.EVEJS_COOP_EVENTS_FILE=prior;
  delete require.cache[modulePath];
  fs.rmSync(dir,{recursive:true,force:true});
 }
});