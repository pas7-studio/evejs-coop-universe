import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {anchorOptionsForRole,anchorOptions}=require("../integration/coopNpcTopology.cjs");
const scene=(belts=true)=>({staticEntities:[
 {itemID:11,kind:"stargate",itemName:"Gate A",position:{x:1,y:2,z:3}},
 {itemID:12,kind:"station",itemName:"Station",position:{x:2,y:3,z:4}},
 ...(belts?[{itemID:13,kind:"asteroidBelt",itemName:"Belt I",position:{x:3,y:4,z:5}}]:[])
]});
test("real Perimeter belts host named pirate and patrol encounters",()=>{
 for(const role of ["pirate","patrol","miner","hauler"])
  assert.deepEqual(anchorOptionsForRole(scene(),role),{
   anchorDescriptor:{kind:"asteroidBelt",itemID:13},anchorName:"Belt I"
  });
 assert.equal(anchorOptions(scene()).anchorDescriptor.kind,"stargate");
});
test("traders prefer real stations; Jita fallback uses its real gate",()=>{
 assert.equal(anchorOptionsForRole(scene(),"trader").anchorDescriptor.itemID,12);
 assert.equal(anchorOptionsForRole(scene(false),"pirate").anchorDescriptor.itemID,11);
 assert.equal(anchorOptionsForRole(scene(false),"patrol").anchorDescriptor.kind,"stargate");
});
test("never invent physical POIs or accept invalid belt coordinates",()=>{
 assert.equal(anchorOptionsForRole({staticEntities:[]}, "pirate"),null);
 assert.equal(anchorOptionsForRole({staticEntities:[
  {itemID:13,kind:"asteroidBelt",itemName:"Fake",position:{x:NaN,y:0,z:0}},
  {itemID:14,kind:"station",itemName:"Real",position:{x:4,y:0,z:0}}
 ]},"pirate").anchorDescriptor.itemID,14);
});
