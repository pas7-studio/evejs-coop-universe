import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {authenticatedCorp,assertCorpRead,assertStructureRead}=require('../integration/coopMoonExtractionReadAccess.cjs');
const actor=(char,corp,other={})=>({characterID:char,corporationID:corp,...other});
const struct={structureID:4501,ownerCorpID:20,ownerID:20};
const owner={getStructureByID(id){return id===4501?struct:null}};
const deny=error=>{throw Error(error)};
test('two different authorized corp pilots can read own real refinery',()=>{
 for(const char of [100,200]){
  assert.equal(authenticatedCorp(actor(char,20)),20);
  assert.equal(assertCorpRead(actor(char,20),20,deny),true);
  assert.equal(assertStructureRead(actor(char,20),4501,owner,deny),true);
 }
});
test('never trust caller-supplied corpID, even a valid other corp',()=>{
 assert.throws(()=>assertCorpRead(actor(100,20),21,deny),/StructureDefenseDenied/);
 assert.throws(()=>assertCorpRead(actor(100,20),0,deny),/StructureDefenseDenied/);
 assert.throws(()=>assertCorpRead(actor(100,20),undefined,deny),/StructureDefenseDenied/);
});
test('arbitrary structureID or ship ID does not grant moon-resource access',()=>{
 assert.throws(()=>assertStructureRead(actor(101,21),4501,owner,deny),/StructureDefenseDenied/);
 assert.throws(()=>assertStructureRead(actor(101,20),9999,owner,deny),/StructureDefenseDenied/);
 assert.throws(()=>assertStructureRead(actor(101,20),0,owner,deny),/StructureDefenseDenied/);
});
test('missing native owner, corrupt conflicting aliases and invalid structure IDs deny',()=>{
 const variants=[{structureID:4501},{structureID:4501,ownerCorpID:20,ownerID:21},
   {structureID:4501,ownerCorpID:20,ownerID:NaN},{structureID:4502,ownerID:20}];
 for(const s of variants)assert.throws(()=>assertStructureRead(actor(101,20),4501,{getStructureByID:()=>s},deny),/StructureDefenseDenied/);
});
test('anonymous, disconnected and conflicting character corporation identity deny',()=>{
 for(const s of [null,{},actor(0,20),actor(1,0),actor(1,20,{corpid:21}),
  actor(1,20,{socket:{destroyed:true}}),actor(1,20,{corpid:'bad'})]){
  assert.equal(authenticatedCorp(s),null);
  assert.throws(()=>assertCorpRead(s,20,deny),/StructureDefenseDenied/);
 }
});
test('native structure lookup failure and missing native functions deny closed',()=>{
 assert.throws(()=>assertStructureRead(actor(1,20),4501,{getStructureByID(){throw Error('db unavailable')}},deny),/StructureDefenseDenied/);
 assert.throws(()=>assertStructureRead(actor(1,20),4501,{},deny),/StructureDefenseDenied/);
 assert.throws(()=>assertCorpRead(actor(1,20),21),/MOON_EXTRACTION_READ_DENIED/);
});

test('extraction must bind seeded moon and owner to the physical native structure',()=>{
 const {assertMoonProfileBound}=require('../integration/coopMoonExtractionReadAccess.cjs');
 const good={structureID:4501,ownerID:20,moonID:55,solarSystemID:30000144};
 const real={structureID:4501,ownerCorpID:20,ownerID:20,moonID:55,solarSystemID:30000144};
 assert.equal(assertMoonProfileBound(4501,good,real,deny),true);
 for(const changed of [{ownerID:21},{moonID:56},{solarSystemID:30000142},{structureID:4502}])
  assert.throws(()=>assertMoonProfileBound(4501,{...good,...changed},real,deny),/StructureDefenseDenied/);
 for(const changed of [{ownerCorpID:21},{moonID:56},{solarSystemID:30000142},
  {ownerCorpID:undefined,ownerID:undefined}])
  assert.throws(()=>assertMoonProfileBound(4501,good,{...real,...changed},deny),/StructureDefenseDenied/);
});
