import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const source=require.resolve("../integration/coopRuntimeProbe.cjs");
function load(destination){
  if(destination===null)delete process.env.EVEJS_COOP_EVENTS_FILE;
  else process.env.EVEJS_COOP_EVENTS_FILE=destination;
  delete require.cache[source];
  return require(source);
}
test("runtime writer confirms durable append and reports disabled/unwritable file",()=>{
  const old=process.env.EVEJS_COOP_EVENTS_FILE;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"coop-witness-"));
  try {
    assert.equal(load(null).observe("test",null,null),false);
    const file=path.join(dir,"nested","events.jsonl");
    assert.equal(load(file).observe("native-test",null,null,{status:"RECORDED"}),true);
    const lines=fs.readFileSync(file,"utf8").trim().split("\n");
    assert.equal(lines.length,1);
    assert.equal(JSON.parse(lines[0]).status,"RECORDED");
    assert.equal(load(dir).observe("cannot-write-to-directory",null,null),false);
  } finally {
    if(old===undefined)delete process.env.EVEJS_COOP_EVENTS_FILE;
    else process.env.EVEJS_COOP_EVENTS_FILE=old;
    delete require.cache[source];
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
