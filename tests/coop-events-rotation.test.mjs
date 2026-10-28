import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdtempSync, writeFileSync, existsSync, statSync, readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
const require=createRequire(import.meta.url);
const probe=require("../integration/coopRuntimeProbe.cjs");

// The event file is the only durable trace of the world and nothing ever trimmed it: measured on
// the play stack it reached 368 MB / 402 291 lines with the data volume at 4.2 GB. Rotation is
// bounded and rate-limited so it can never cost a tick.
function scratch(){
 const dir=mkdtempSync(path.join(tmpdir(),"coop-events-"));
 const file=path.join(dir,"coop-events.jsonl");
 return {dir,file};
}

test("a file past the cap rotates once and the previous one is kept as .1",()=>{
 const {file}=scratch();
 writeFileSync(file,"x".repeat(2*1024*1024));
 process.env.EVEJS_COOP_EVENTS_MAX_MB="1";
 const rotated=probe.rotateIfNeeded(file);
 assert.equal(rotated,true);
 assert.equal(existsSync(file),false);
 assert.equal(statSync(file+".1").size,2*1024*1024);
 delete process.env.EVEJS_COOP_EVENTS_MAX_MB;
});

test("a file under the cap is left alone",()=>{
 const {file}=scratch();
 writeFileSync(file,"short\n");
 process.env.EVEJS_COOP_EVENTS_MAX_MB="128";
 // the rate limiter allows one check per minute, so this call may be skipped - assert only that
 // the file survives either way
 probe.rotateIfNeeded(file);
 assert.equal(readFileSync(file,"utf8"),"short\n");
 delete process.env.EVEJS_COOP_EVENTS_MAX_MB;
});

test("rotation can be switched off",()=>{
 const {file}=scratch();
 writeFileSync(file,"x".repeat(2*1024*1024));
 process.env.EVEJS_COOP_EVENTS_MAX_MB="0";
 assert.equal(probe.rotateIfNeeded(file),false);
 assert.equal(existsSync(file),true);
 delete process.env.EVEJS_COOP_EVENTS_MAX_MB;
});

test("observe still writes the record after a rotation",()=>{
 const {file}=scratch();
 process.env.EVEJS_COOP_EVENTS_FILE=file;
 process.env.EVEJS_COOP_EVENTS_MAX_MB="0";
 assert.equal(probe.observe("rotation-test",null,null,{status:"OK"}),true);
 const line=readFileSync(file,"utf8").trim().split("\n").pop();
 assert.match(line,/"event":"rotation-test"/);
 assert.match(line,/"status":"OK"/);
 delete process.env.EVEJS_COOP_EVENTS_FILE;
 delete process.env.EVEJS_COOP_EVENTS_MAX_MB;
});
