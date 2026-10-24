import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
const require=createRequire(import.meta.url);
const {createLife}=require("../integration/coopNpcLife.cjs");

test("real native wreck retires a named pilot across process restarts, then allows clone recovery",()=>{
 const dir=mkdtempSync(join(tmpdir(),"evejs-life-"));
 try{
  let now=100000;
  const file=join(dir,"life.json"),clock=()=>now;
  const make=()=>createLife({file,clock,recoveryMs:1800000});
  const initial=make();
  assert.equal(initial.canFly("coop-pilot-005"),true);
  const death=initial.markLoss({pilotID:"coop-pilot-005",systemID:30000142,shipID:123456,wreckID:987654});
  assert.equal(death.status,"RECOVERING");
  const restarted=make();
  assert.equal(restarted.canFly("coop-pilot-005"),false);
  assert.equal(restarted.markLoss({pilotID:"coop-pilot-005",systemID:30000142,shipID:123456,wreckID:987654}).status,"DUPLICATE");
  now+=1799999;
  assert.equal(restarted.canFly("coop-pilot-005"),false);
  now+=1;
  assert.equal(restarted.recover("coop-pilot-005").status,"ACTIVE");
  assert.equal(make().snapshot().pilots["coop-pilot-005"].lossCount,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("invalid/native-unrelated wreck cannot retire a virtual pilot",()=>{
 const dir=mkdtempSync(join(tmpdir(),"evejs-life-"));
 try{
  const life=createLife({file:join(dir,"life.json")});
  assert.equal(life.markLoss({pilotID:"someone-else",systemID:30000142,shipID:1,wreckID:2}).status,"INVALID");
  assert.deepEqual(life.snapshot().pilots,{});
 }finally{rmSync(dir,{recursive:true,force:true});}
});
