import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {authorizeFitSource:allow}=require('../integration/coopNativeFittingSourceGuard.cjs');
const f=()=>({characterID:101,ship:{itemID:1011,ownerID:101,categoryID:6},
 descriptor:{sourceKind:'inventory',item:{itemID:401,typeID:600,ownerID:101,locationID:60000123,singleton:1,stacksize:1}},
 sourceLocationID:60000123,sourceLocationVerified:true,sourceAccessVerified:true,shipAccessVerified:true});
test('owned source may pass only after positive native access proofs',()=>{
 assert.equal(allow(f()).allowed,true);
});
test('cannot fit an existing item belonging to an unrelated pilot',()=>{
 assert.equal(allow({...f(),descriptor:{sourceKind:'inventory',item:{...f().descriptor.item,ownerID:202}}}).reason,'FITTING_ITEM_NOT_OWNED');
});
test('cannot modify another pilot ship through globally resolved shipID',()=>{
 assert.equal(allow({...f(),ship:{...f().ship,ownerID:202}}).reason,'FITTING_SHIP_NOT_OWNED');
});
test('claimed source location and native access are independently required',()=>{
 assert.equal(allow({...f(),sourceLocationVerified:false}).reason,'FITTING_SOURCE_ACCESS_DENIED');
 assert.equal(allow({...f(),sourceAccessVerified:false}).reason,'FITTING_SOURCE_ACCESS_DENIED');
 assert.equal(allow({...f(),shipAccessVerified:false}).reason,'FITTING_SHIP_NOT_OWNED');
});
test('unknown item, native wreck and missing owner fail closed',()=>{
 assert.equal(allow({...f(),descriptor:{sourceKind:'nativeWreck',item:f().descriptor.item}}).allowed,false);
 assert.equal(allow({...f(),descriptor:null}).allowed,false);
 assert.equal(allow({...f(),descriptor:{sourceKind:'inventory',item:{...f().descriptor.item,ownerID:0}}}).allowed,false);
});
test('reject malformed stack and allow independent two-pilot ownership',()=>{
 assert.equal(allow({...f(),descriptor:{sourceKind:'inventory',item:{...f().descriptor.item,singleton:0,stacksize:0}}}).allowed,false);
 const a=f(),b={...f(),characterID:202,ship:{itemID:2022,ownerID:202,categoryID:6},descriptor:{sourceKind:'inventory',item:{...f().descriptor.item,itemID:402,ownerID:202}}};
 assert.equal(allow(a).allowed,true);assert.equal(allow(b).allowed,true);
 assert.equal(allow({...a,descriptor:b.descriptor}).allowed,false);
});
