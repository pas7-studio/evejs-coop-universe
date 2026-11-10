"""PF70: execute actual PF58 adoption and PF69 patch pair validator together.

Uses the existing native CJS adoption module and the real injected JavaScript
pair validation function (from the source-pinned PF58 patch builder). No
server is started, and ItemStore/native writers are isolated adapters.
"""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / 'native/coopPersonalFleetNativeShipAdoption.cjs'
SPEC = importlib.util.spec_from_file_location('pf70_real_source_patch', ROOT / 'build_native_stock_fittings_patch.py')
PATCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PATCH)

NODE = r'''"use strict";
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {createNativeShipAdoption}=require(process.argv[2]);
const context={};
vm.runInNewContext(fs.readFileSync(process.argv[3],'utf8'),context,{timeout:1000});
const pair=context.pf58OriginalNativePairValid;
assert.equal(typeof pair,'function');

const row={shipItemID:1001,ownerCharacterID:202,systemID:300,typeID:606,
 generation:3,assignmentID:'pf70-assignment-3',pilotID:'coop-pilot-123'};
const stock={itemID:1001,ownerID:202,typeID:606,categoryID:6,
 singleton:1,stacksize:1,quantity:-1,locationID:300,flagID:0,
 spaceState:{systemID:300,position:{x:1,y:2,z:3}}};
const sceneEntities=new Map();
const scene={systemID:300,getEntityByID:id=>sceneEntities.get(id)||null};
const records={entity:null,controller:null};
let nativeWrites=0,sceneWrites=0;
const nativeStore={
 getNativeEntity:()=>records.entity,getNativeController:()=>records.controller,
 listNativeModulesForEntity:()=>[],listNativeCargoForEntity:()=>[],
 upsertNativeEntity:record=>{records.entity=structuredClone(record);nativeWrites++;return {success:true};},
 upsertNativeController:record=>{records.controller=structuredClone(record);nativeWrites++;return {success:true};}
};
const service={PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1:true,
 materializeStoredNativeController(sceneArg,shipID,options){
  assert.equal(sceneArg,scene);assert.equal(shipID,row.shipItemID);
  assert.equal(options.personalFleetIssuing,true);
  if(pair(records.entity,records.controller)!==true)return {success:false,errorMsg:'PF70_NATIVE_PAIR_REJECTED'};
  sceneWrites++;
  sceneEntities.set(shipID,{itemID:shipID,nativeNpc:true,ownerID:row.ownerCharacterID});
  return {success:true,data:{entity:sceneEntities.get(shipID),controller:records.controller}};
 }};
const api=createNativeShipAdoption({nativeStore,stockItems:{findItemById:()=>structuredClone(stock)},
 npcService:service,spaceRuntime:{scenes:new Map([[row.systemID,scene]])},
 resolveNativeProfile:()=>({profile:{shipTypeID:606,profileID:'original'},
  loadout:{loadoutID:'stock'},behaviorProfile:{behaviorProfileID:'npc-pf'}}),
 resolveOwnerCorporation:()=>404,
 verifyCommittedPermit:()=>true,allWritersFenced:()=>true,enabled:()=>true,clock:()=>1800000000000});
const result=api.adoptOriginalShipAsNpc(row,structuredClone(stock));
assert.equal(result.success,true,JSON.stringify(result));
assert.equal(nativeWrites,2);assert.equal(sceneWrites,1);
assert.equal(pair(records.entity,records.controller),true);
assert.equal(records.entity.selectionKind,'PERSONAL_FLEET');
assert.equal(records.entity.selectionID,row.assignmentID);
assert.equal(records.controller.selectionID,row.assignmentID);
assert.equal(records.entity.entityID,stock.itemID);
assert.equal(sceneEntities.size,1);
for(const [e,c] of [
 [{...records.entity,selectionID:'foreign'},records.controller],
 [{...records.entity,selectionKind:'other'},records.controller],
 [records.entity,{...records.controller,selectionKind:'other'}],
 [records.entity,{...records.controller,selectionID:'foreign'}],
 [records.entity,{...records.controller,personalFleetGeneration:999}],
 [{...records.entity,personalFleetOriginal:false},records.controller],
])assert.equal(pair(e,c),false);
assert.equal(stock.itemID,1001);assert.equal(stock.flagID,0);
console.log('PF70 real adoption -> PF69 source-patched pair: PASS');
'''

class OriginalNativePairContract(unittest.TestCase):
    def test_production_adoption_row_is_admissible_by_source_patched_materializer(self):
        self.assertTrue(NATIVE.is_file(), 'PF70 original adoption source is missing')
        with tempfile.TemporaryDirectory(prefix='pf70-adoption-pair-') as d:
            root = Path(d)
            (root/'validator.js').write_text(PATCH.HEADER, encoding='utf-8')
            (root/'run.cjs').write_text(NODE, encoding='utf-8')
            result = subprocess.run(['node', str(root/'run.cjs'), str(NATIVE.resolve()),
                                      str(root/'validator.js')],capture_output=True,text=True,timeout=15)
            self.assertEqual(result.returncode,0,result.stderr+'\n'+result.stdout)
            self.assertIn('PF70 real adoption -> PF69 source-patched pair: PASS',result.stdout)

if __name__ == '__main__': unittest.main()
