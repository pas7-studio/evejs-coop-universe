import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {buildGroups,getMarketGroups,HEADERS}=require("../integration/coopMarketCatalog.cjs");
const data={types:[
  {typeID:34,published:true,marketGroupID:500,groupName:"Minerals",iconID:2},
  {typeID:35,published:true,marketGroupID:500,groupName:"Minerals"},
  {typeID:597,published:true,marketGroupID:110,groupName:"Frigates",graphicID:6},
  {typeID:100,published:false,marketGroupID:111,groupName:"Secret"},
  {typeID:33,published:true,marketGroupID:null},
  {typeID:34,published:true,marketGroupID:500,groupName:"Resources"}
]};
test("uses actual SDE marketGroupID and only published native type IDs",()=>{
 const groups=buildGroups(data);
 assert.equal(groups.length,2);
 assert.deepEqual(groups.map(x=>x.marketGroupID),[110,500]);
 assert.deepEqual(groups.map(x=>x.marketGroupName),["Frigates","Minerals"]);
 assert.deepEqual(groups.map(x=>x.parentGroupID),[0,0]);
 assert.equal(groups[0].hasTypes,true);
});
test("does not invent categories from zero, unpublished, invalid or missing data",()=>{
 assert.deepEqual(buildGroups({types:[{typeID:1,published:false,marketGroupID:17}]}),[]);
 assert.deepEqual(buildGroups({}),[]);
 assert.deepEqual(buildGroups({types:[{typeID:2,published:true,marketGroupID:-1}]}),[]);
});
test("returns the EXACT native rowset header and native SDE IDs",()=>{
 let invoked=0;
 const output=getMarketGroups({read:()=>data,buildRowset:(columns,rows,name)=>{invoked++;return {columns,rows,name}}});
 assert.equal(invoked,1);
 assert.deepEqual(output.columns,HEADERS);
 assert.equal(output.rows.length,2);
 assert.equal(output.rows[1][1],500);
 assert.equal(output.rows[1][2],"Minerals");
 assert.equal(output.rows[1][5],true);
});