import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createFireDebitProof}=require("../integration/coopNpcFireDebitProof.cjs");
function f(){
 const entity={kind:"ship",nativeNpc:true,itemID:101,ownerID:900,systemID:30000144};
 const moduleItem={itemID:401,typeID:12001,flagID:27};
 const chargeItem={itemID:501,typeID:35,quantity:5,stacksize:5};
 const native={entityID:101,ownerID:900,systemID:30000144};
 const modules=[{moduleID:401,entityID:101,ownerID:900,categoryID:7,flagID:27}];
 const cargo=[{cargoID:501,entityID:101,ownerID:900,categoryID:8,flagID:27,
  moduleID:401,typeID:35,quantity:5,transient:true}];
 const store={getNativeEntity:()=>native,
  listNativeModulesForEntity:()=>modules.map(x=>({...x})),
  listNativeCargoForEntity:()=>cargo.map(x=>({...x}))};
 const env={EVEJS_COOP_NPC_STRICT_AMMO:"1"};
 const instance=()=>createFireDebitProof({store,env});
 const check=()=>instance().verify({entity,moduleItem,chargeItem,quantity:1});
 return {entity,moduleItem,chargeItem,native,modules,cargo,store,env,instance,check};
}
test("real authoritative native transient magazine is valid source, no virtual stock",()=>{
 const x=f();assert.equal(x.check().allowed,true);
 assert.equal(x.check().quantity,5);
 assert.equal(x.cargo.length,1);
});
test("missing source cargo fails closed even if cached charge remains",()=>{
 const x=f();x.cargo.splice(0);
 assert.equal(x.check().status,"NATIVE_FIRE_CARGO_MISSING");
});
test("stale runtime charge quantity may not increment authoritative native inventory",()=>{
 const x=f();x.cargo[0].quantity=4;
 assert.equal(x.check().status,"NATIVE_FIRE_STALE_OR_FORGED_CHARGE");
 x.chargeItem.quantity=4;
 assert.equal(x.check().allowed,true);
});
test("an incorrect native owner, wrong module and wrong charge type cannot pass",()=>{
 const x=f();x.cargo[0].ownerID=901;
 assert.equal(x.check().allowed,false);
 x.cargo[0].ownerID=900;x.cargo[0].moduleID=999;
 assert.equal(x.check().allowed,false);
 x.cargo[0].moduleID=401;x.cargo[0].typeID=40;
 assert.equal(x.check().allowed,false);
});
test("native source magazine flag must belong to the exact fitted slot",()=>{
 const x=f();x.cargo[0].flagID=28;
 assert.equal(x.check().allowed,false);
 x.cargo[0].flagID=27;x.modules[0].flagID=28;
 assert.equal(x.check().allowed,false);
});
test("wrong stored ship ownership or lost physical module fail closed",()=>{
 const x=f();x.native.ownerID=901;
 assert.equal(x.check().status,"NATIVE_FIRE_SHIP_NOT_VERIFIED");
 x.native.ownerID=900;x.modules.splice(0);
 assert.equal(x.check().status,"NATIVE_FIRE_MODULE_NOT_VERIFIED");
});
test("source quantity under volley requirement never reports an authorized shot",()=>{
 const x=f();x.cargo[0].quantity=1;x.chargeItem.quantity=1;
 assert.equal(x.instance().verify({entity:x.entity,moduleItem:x.moduleItem,
  chargeItem:x.chargeItem,quantity:2}).allowed,false);
});
test("duplicate module and cargo rows are rejected instead of arbitrary first match",()=>{
 const x=f();x.modules.push({...x.modules[0]});
 assert.equal(x.check().allowed,false);
 x.modules.splice(1);x.cargo.push({...x.cargo[0]});
 assert.equal(x.check().allowed,false);
});
test("bank preflight requires distinct real charge per physical barrel",()=>{
 const x=f();x.modules.push({moduleID:402,entityID:101,
  ownerID:900,categoryID:7,flagID:28});
 x.cargo.push({cargoID:502,entityID:101,ownerID:900,
  categoryID:8,flagID:28,moduleID:402,typeID:35,quantity:3});
 const entries=[{moduleItem:x.moduleItem,chargeItem:x.chargeItem},
  {moduleItem:{itemID:402,flagID:28},
   chargeItem:{itemID:502,typeID:35,quantity:3}}];
 assert.equal(x.instance().verifyBank({entity:x.entity,entries}).allowed,true);
 x.cargo[1].quantity=0;
 assert.equal(x.instance().verifyBank({entity:x.entity,entries}).allowed,false);
});
test("bank cannot spend one cargo row twice for two module IDs",()=>{
 const x=f();const entry={moduleItem:x.moduleItem,chargeItem:x.chargeItem};
 assert.equal(x.instance().verifyBank({entity:x.entity,
  entries:[entry,entry]}).status,"NATIVE_FIRE_BANK_DUPLICATE");
});
test("native storage exception fails closed without creating stock",()=>{
 const x=f();x.store.getNativeEntity=()=>{throw Error("DB_UNAVAILABLE")};
 assert.equal(x.check().status,"NATIVE_FIRE_PROOF_UNAVAILABLE");
 assert.equal(x.cargo[0].quantity,5);
});
test("legacy mode and real player ships bypass new native-only guard",()=>{
 const x=f();x.env.EVEJS_COOP_NPC_STRICT_AMMO="0";
 x.cargo.splice(0);assert.equal(x.check().allowed,true);
 x.env.EVEJS_COOP_NPC_STRICT_AMMO="1";x.entity.nativeNpc=false;
 assert.equal(x.check().allowed,true);
});
