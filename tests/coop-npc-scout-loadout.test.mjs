import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNpcScoutLoadout}=require("../integration/coopNpcScoutLoadout.cjs");
const {patch,FILE}=require("../scripts/coop-npc-scout-loadout-patch.cjs");
const {patch:splitPatch,FILE:splitFile}=require("../scripts/coop-npc-probe-loadout-split-patch.cjs");
function authority({compatible=true}={}){
 return createNpcScoutLoadout({
  resolveItemByTypeID:id=>id===17938?{typeID:id,groupID:481,categoryID:7}:
   id===30013?{typeID:id,groupID:479,categoryID:8}: 
   {typeID:id,groupID:53,categoryID:7},
  compatibleCharges:id=>compatible&&id===17938?[30013]:[]
 });
}
function original(){
 return {profile:{profileID:"concord_police_cruiser"},
  loadout:{loadoutID:"concord_police",modules:[{typeID:1001,quantity:1}],charges:[]}};
}
test("EX-03B4 creates original authored launcher and four split-ready probe charges",()=>{
 const source=original(),result=authority().apply(source);
 assert.equal(result.success,true);
 assert.equal(source.loadout.modules.length,1);
 assert.equal(result.definition.loadout.modules.length,2);
 assert.deepEqual(result.definition.loadout.modules.at(-1),{typeID:17938,quantity:1});
 assert.deepEqual(result.definition.loadout.charges.at(-1),
  {typeID:30013,quantityPerModule:4,singleton:false});
});
test("no native compatibility or missing item types cannot inject scanner hardware",()=>{
 assert.equal(authority({compatible:false}).apply(original()).success,false);
 assert.equal(createNpcScoutLoadout({
  resolveItemByTypeID:()=>null,compatibleCharges:()=>[30013]
 }).apply(original()).success,false);
});
test("existing launcher cannot receive a duplicate, even with valid stock",()=>{
 const def=original();def.loadout.modules.push({typeID:17938,quantity:1});
 assert.equal(authority().apply(def).errorMsg,"NPC_SCOUT_LAUNCHER_ALREADY_PRESENT");
});
test("corrupt modules and anonymous profiles cannot be minted into scouts",()=>{
 const def=original();def.profile.profileID="";
 assert.equal(authority().apply(def).success,false);
 const another=original();another.loadout.modules[0].typeID=-1;
 assert.equal(authority().apply(another).success,false);
});
test("pinned original nativeNpcService loadout authoring patch is reversible",()=>{
 const filename=process.env.EVEJS_PINNED_NPC_SERVICE_SOURCE;
 if(!filename||!fs.existsSync(filename))return;
 const s=fs.readFileSync(filename,"utf8");
 const withSplit=splitPatch(s,splitFile),withScout=patch(withSplit,FILE);
 assert.equal(patch(withScout,FILE),withScout);
 assert.equal(splitPatch(patch(withScout,FILE,true),splitFile,true),s);
 assert.doesNotThrow(()=>new Function("require","module","exports","__dirname",withScout));
});
test("EX-03B4 source patch fails closed when original NPC source drifts",()=>{
 assert.throws(()=>patch("bogus",FILE),/ANCHOR_DRIFT/);
});
