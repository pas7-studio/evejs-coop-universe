import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch,FILE,BEGIN,END}=require("../scripts/coop-native-warehouse-item-patch.cjs");
const stub="function writeItems() {}\nfunction nextItemID() {}\nmodule.exports = {\n};\n";
function native(){
 const patched=patch(stub,FILE),from=patched.indexOf(BEGIN),to=patched.indexOf(END);
 assert.ok(from>=0&&to>from);
 const hook=patched.slice(from,to+END.length);
 let items={
  601:{itemID:601,typeID:34,ownerID:1001,locationID:2001,
   flagID:4,singleton:0,quantity:10,stacksize:10,customInfo:""}
 },writes=0,next=701;
 const env={
  ensureMigrated(){},ITEM_FLAGS:{HANGAR:4},CLIENT_INVENTORY_STACK_LIMIT:2147483647,
  readItems:()=>items,cloneValue:x=>structuredClone(x),
  nextItemID:()=>next++,
  resolveItemTypeReference:({typeID})=>({typeID,categoryID:4}),
  shouldItemDefaultToSingleton:()=>false,
  buildInventoryItem:x=>({...x,itemName:"Ore",categoryID:4,groupID:18}),
  writeItems:x=>{writes++;items=x;return true}
 };
 const f=new Function("env","with(env){ "+hook+"\n;return {grantUniqueNpcDepotItem,findWarehouseItem};}")(env);
 return {...f,get items(){return items},get writes(){return writes}};
}
const args={ownerID:1001,stationID:2001,typeID:34,quantity:50,cargoID:777};
test("actual COOP-030 source grants one physically separate original cargo itemID",()=>{
 const f=native(),x=f.grantUniqueNpcDepotItem(args);
 assert.equal(x.success,true);assert.equal(x.data.existing,false);
 assert.equal(f.items[601].quantity,10);
 assert.equal(f.findWarehouseItem({cargoID:777}).itemID,x.data.itemID);
 assert.equal(f.findWarehouseItem({cargoID:777}).customInfo,"coop-warehouse:v1:cargo:777");
 assert.equal(f.findWarehouseItem({cargoID:777}).quantity,50);
 assert.equal(f.writes,1);
});
test("real COOP-030 grant is idempotent before and after source readback",()=>{
 const f=native(),first=f.grantUniqueNpcDepotItem(args);
 const second=f.grantUniqueNpcDepotItem(args);
 assert.equal(second.success,true);assert.equal(second.data.existing,true);
 assert.equal(second.data.itemID,first.data.itemID);
 assert.equal(f.writes,1);
});
test("real COOP-030 hook returns collision when same cargo tag moves owner",()=>{
 const f=native();
 assert.equal(f.grantUniqueNpcDepotItem(args).success,true);
 assert.equal(f.grantUniqueNpcDepotItem({...args,ownerID:1002}).errorMsg,
  "NATIVE_WAREHOUSE_TAG_COLLISION");
 assert.equal(f.writes,1);
});
test("real COOP-030 source refuses duplicate warehouse cargo marker",()=>{
 const f=native();
 f.grantUniqueNpcDepotItem(args);
 f.items[705]={...f.items[701],itemID:705};
 assert.equal(f.grantUniqueNpcDepotItem(args).errorMsg,
  "DUPLICATE_NATIVE_WAREHOUSE_TAG");
 assert.throws(()=>f.findWarehouseItem({cargoID:777}),
  /WAREHOUSE_DUPLICATE_NATIVE_ITEM_TAG/);
});
test("real COOP-030 hook refuses quantities above original client stack bound",()=>{
 const f=native();
 assert.equal(f.grantUniqueNpcDepotItem({...args,quantity:2147483648}).errorMsg,
  "INVALID_NATIVE_WAREHOUSE_GRANT");
 assert.equal(f.writes,0);
});
test("stock patch remains reversible, idempotent and CRLF safe",()=>{
 for(const text of [stub,stub.replaceAll("\n","\r\n")]){
  const changed=patch(text,FILE);
  assert.equal(patch(changed,FILE),changed);
  assert.equal(patch(changed,FILE,true),text);
 }
});
test("native depot hook only owns source ItemStore row, no second wallet/SQL writer",()=>{
 const source=fs.readFileSync(new URL("../scripts/coop-native-warehouse-item-patch.cjs",import.meta.url),"utf8");
 assert.doesNotMatch(source,/setInterval\s*\(|setTimeout\s*\(|\.credit\s*\(/);
});
