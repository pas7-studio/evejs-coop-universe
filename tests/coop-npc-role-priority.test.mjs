import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {orderForMaterialization}=require("../integration/coopNpcRolePriority.cjs");
test("three native slots favor two pirates and a patrol, not idle traders",()=>{
 const pilots=[
  {id:"coop-pilot-003",role:"trader"},
  {id:"coop-pilot-004",role:"patrol"},
  {id:"coop-pilot-005",role:"pirate"},
  {id:"coop-pilot-006",role:"trader"},
  {id:"coop-pilot-007",role:"patrol"},
  {id:"coop-pilot-008",role:"pirate"}
 ];
 assert.deepEqual(orderForMaterialization(pilots).slice(0,3).map(p=>p.role),
  ["pirate","pirate","patrol"]);
 assert.deepEqual(pilots.map(p=>p.role).slice(0,3),["trader","patrol","pirate"]);
});
test("six native slots still include all organic PvE roles",()=>{
 const roles=["trader","patrol","pirate","trader","patrol","pirate"];
 const ordered=orderForMaterialization(roles.map((role,i)=>({role,id:String(i)})));
 assert.equal(ordered.length,6);
 assert.deepEqual(ordered.map(p=>p.role),["pirate","pirate","patrol","patrol","trader","trader"]);
});
test("priorities are deterministic without mutating saved world order",()=>{
 const input=[{id:"coop-pilot-011",role:"pirate"},{id:"coop-pilot-010",role:"pirate"}];
 assert.deepEqual(orderForMaterialization(input).map(p=>p.id),
  ["coop-pilot-010","coop-pilot-011"]);
 assert.equal(input[0].id,"coop-pilot-011");
 assert.deepEqual(orderForMaterialization(null),[]);
});
