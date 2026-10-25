import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {check,parse}=require("../integration/coopNativeLpStandings.cjs");
const {patch}=require("../scripts/coop-native-lp-standing-patch.cjs");
const {specs,transform}=require("../scripts/patch-evejs-coop.cjs");
const native=process.env.EVEJS_COOP_CODE_PATH || "";
const standingRuntime={
 getCharacterEffectiveStanding:(_char,owner)=>({standing:owner===100?3.5:owner===200?-2:0})
};
const checkRule=(requirements,characterID=777,corpID=100)=>
 check({requirements,characterID,corpID,standingRuntime});

test("native LP store allows offers with no standing requirements",()=>{
 for(const r of [null,undefined,false,0,"",[]])
  assert.equal(checkRule(r).ok,true,JSON.stringify(r));
 assert.equal(checkRule({ownerID:100,value:3}).ok,true);
 assert.equal(checkRule(3.5).ok,true);
 assert.equal(checkRule([100,3.5]).ok,true);
 assert.equal(checkRule([{ownerID:100,value:2},{ownerID:200,value:-3}]).ok,true);
});

test("LP standing requirements are per-character and checked against real native owner",()=>{
 const low=checkRule({ownerID:100,value:3.6});
 assert.deepEqual(low,{ok:false,errorMsg:"STANDING_REQUIREMENT_NOT_MET",
  ownerID:100,required:3.6,actual:3.5});
 assert.equal(checkRule({ownerID:200,value:-1}).ok,false);
 assert.equal(checkRule([{ownerID:100,value:3},{ownerID:200,value:1}]).ok,false);
 assert.equal(checkRule(4).ok,false,"Unqualified corp store offer is blocked");
 assert.equal(check({requirements:3,characterID:0,corpID:100,standingRuntime}).ok,false);
 assert.equal(check({requirements:3,characterID:777,corpID:100,standingRuntime:{}}).ok,false);
});

test("unknown and invalid standing rules fail closed, never grant items",()=>{
 for(const invalid of [{ownerID:0,value:1},{ownerID:100,value:"inf"},
   {ownerID:100,value:12},{ownerID:100}, "not-a-number",[0,2],{ownerID:100,value:NaN}]){
  const result=checkRule(invalid);
  assert.equal(result.ok,false,JSON.stringify(invalid));
  assert.equal(result.errorMsg,"UNSUPPORTED_STANDING_REQUIREMENT");
 }
 assert.equal(parse({ownerID:100,value:1},100).rules.length,1);
 assert.equal(check({requirements:{ownerID:100,value:1},characterID:777,corpID:100,
  standingRuntime:{getCharacterEffectiveStanding:()=>null}}).ok,false);
});

test("native LP Store adapter only guards pre-debit section, preserves stock refund",t=>{
 if(!native){t.skip("Set EVEJS_COOP_CODE_PATH for pinned source");return;}
 const file="server/src/services/evermarks/lpStoreMgrService.js";
 const spec=specs.find(s=>s.file===file);
 assert.ok(spec);
 const src=fs.readFileSync(path.join(native,file),"utf8");
 const original=transform(src,spec,true);
 const applied=transform(original,spec,false);
 assert.equal(transform(applied,spec,false),applied);
 assert.equal(transform(applied,spec,true),original);
 assert.equal(patch(applied,file),applied);
 new vm.Script(applied,{filename:file});
 const gate=applied.indexOf('EVEJS_COOP_LP_STANDING_REQUIREMENTS === "1"');
 const debit=applied.indexOf("const lpResult = adjustCharacterWalletLPBalance(",gate);
 const grant=applied.indexOf("const grantResult = grantItemToCharacterLocation(",debit);
 assert.ok(gate>0&&debit>gate&&grant>debit);
 assert.match(applied,/rollbackStaticLpStorePurchase/);
 assert.match(applied,/STANDING_REQUIREMENT_NOT_MET/);
});
