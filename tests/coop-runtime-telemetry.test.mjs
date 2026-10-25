import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const probe=require('../integration/coopRuntimeProbe.cjs');
const saved=process.env.EVEJS_COOP_EVENTS_FILE;
const oldWarn=console.warn;
function restore(){ if(saved===undefined) delete process.env.EVEJS_COOP_EVENTS_FILE;else process.env.EVEJS_COOP_EVENTS_FILE=saved;console.warn=oldWarn; }
test('startup evidence is appended before any player login and survives repeated writes',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'evejs-probe-'));
 try{
  process.env.EVEJS_COOP_EVENTS_FILE=path.join(folder,'volume','coop-events.jsonl');
  assert.equal(probe.observe('living-startup-entered',null,null,{status:'START_REQUESTED_NOT_READY'}),true);
  assert.equal(probe.observe('living-headless-boot-requested',null,null,{systems:[30000142]}),true);
  const lines=fs.readFileSync(process.env.EVEJS_COOP_EVENTS_FILE,'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines.map(x=>x.event),['living-startup-entered','living-headless-boot-requested']);
  assert.equal(lines[0].characterID,null);
 }finally{restore();fs.rmSync(folder,{recursive:true,force:true});}
});
test('unset telemetry path does not falsely create event and reports actionable config blocker once',()=>{
 const warnings=[];console.warn=(x)=>warnings.push(String(x));
 try{
  delete process.env.EVEJS_COOP_EVENTS_FILE;
  assert.equal(probe.observe('living-startup-entered',null,null),false);
  assert.equal(probe.observe('living-startup-entered',null,null),false);
  assert.equal(warnings.length,1);
  assert.match(warnings[0],/BLOCKED_TELEMETRY_CONFIG/);
 }finally{restore();}
});
test('unwritable target fails safely, warns once without revealing path',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'evejs-probe-deny-'));
 const warnings=[];console.warn=(x)=>warnings.push(String(x));
 try{
  const parent=path.join(folder,'not-a-directory');fs.writeFileSync(parent,'x');
  process.env.EVEJS_COOP_EVENTS_FILE=path.join(parent,'events.jsonl');
  assert.equal(probe.observe('living-headless-boot-requested',null,null),false);
  assert.equal(probe.observe('living-headless-boot-requested',null,null),false);
  assert.equal(warnings.length,1);
  assert.match(warnings[0],/BLOCKED_TELEMETRY_WRITE_/);
  assert.ok(!warnings[0].includes(folder));
 }finally{restore();fs.rmSync(folder,{recursive:true,force:true});}
});
test('configured telemetry path can recover after a bad destination without restart',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'evejs-probe-recover-'));
 const warnings=[];console.warn=(x)=>warnings.push(String(x));
 try{
  process.env.EVEJS_COOP_EVENTS_FILE=path.join(folder,'good.jsonl');
  assert.equal(probe.observe('living-startup-entered',null,null),true);
  assert.equal(fs.existsSync(process.env.EVEJS_COOP_EVENTS_FILE),true);
  assert.ok(warnings.length<=1);
 }finally{restore();fs.rmSync(folder,{recursive:true,force:true});}
});