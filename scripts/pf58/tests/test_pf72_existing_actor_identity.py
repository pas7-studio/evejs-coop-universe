"""PF72: test real transformed low-level materializer refuses foreign scene actors.

Original-shape source fixture uses exact pinned nativeNpcService signatures. No
server or stock gameplay is started. No native source file is edited.
"""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
TESTS=ROOT/'tests'
def imp(name, path):
    spec=importlib.util.spec_from_file_location(name,path)
    obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj);return obj
B=imp('pf72_builder',ROOT/'build_native_stock_fittings_patch.py')
PF71=imp('pf72_fixture',TESTS/'test_pf71_common_native_entrypoint.py')
NODE=r'''const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync(process.argv[2],'utf8');
const base={entityID:1001,systemID:300,ownerID:202,profileID:'pr',loadoutID:'stock',
 behaviorProfileID:'peace',entityType:'personalFleet',selectionKind:'PERSONAL_FLEET',
 selectionID:'a-1',personalFleetOriginal:true,operatorKind:'PERSONAL_FLEET',
 personalFleetGeneration:3,personalFleetAssignmentID:'a-1',personalFleetPilotID:'coop-pilot-123'};
const entity={...base,nativeNpc:true},controller={...base,runtimeKind:'nativeAmbient'};
const goodActor={itemID:1001,kind:'ship',nativeNpc:true,nativeNpcOccupied:true,
 npcEntityType:'personalFleet',operatorKind:'PERSONAL_FLEET',selectionKind:'PERSONAL_FLEET',
 selectionID:'a-1',ownerID:202,characterID:0,pilotCharacterID:0,session:null};
const ordinary={entityID:1002,systemID:300};
let cases=0;
function run(actor, e=entity, c=controller, options={}){
 let register=0,spawn=0,auth=0;
 const scene={systemID:300,getEntityByID:()=>actor};
 const source=code.replace("const path=require('path');",'')
   .replace('const nativeNpcStore={};','').replace('const spaceRuntime={};','');
 const sandbox={__dirname:'/isolated/space/npc',module:{exports:{}},
  path:{join:()=>'/isolated/space/coopPersonalFleetNativeBindings'},
  process:{env:{EVEJS_COOP_PERSONAL_FLEET_NATIVE_SHIP_ADOPTION:'1'}},
  require:()=>({authorize:()=>{auth++;return true;}}),
  nativeNpcStore:{},spaceRuntime:{spawnDynamicShip:()=>{spawn++;return {success:true,data:{entity:actor}};}},
  registerNativeRuntimeController:()=>{register++;return {entityID:e.entityID}},
  isNativeAmbientRuleOptions(){}};
 vm.runInNewContext(source,sandbox,{timeout:1000});
 const result=sandbox.materializeNativeRuntimeEntity(scene,e,c,{},{});
 cases++;return {result,register,spawn,auth};
}
function deny(actor, e=entity, c=controller){
 const r=run(actor,e,c);
 assert.equal(r.result.success,false);
 assert.equal(r.result.errorMsg,'PF72_FOREIGN_EXISTING_SCENE_ACTOR');
 assert.equal(r.register,0);assert.equal(r.spawn,0);assert.equal(r.auth,1);
}
// An original PF actor with its exact durable identity can resume safely.
let r=run(goodActor);assert.equal(r.result.success,true);assert.equal(r.register,1);
// Foreign or player session actor sharing the exact itemID must not be converted.
for (const actor of [
 {...goodActor,kind:'structure'},
 {...goodActor,itemID:1005},
 {...goodActor,nativeNpc:false},
 {...goodActor,nativeNpcOccupied:false},
 {...goodActor,npcEntityType:'pirate'},
 {...goodActor,operatorKind:'MINING'},
 {...goodActor,selectionKind:'OTHER'},
 {...goodActor,selectionID:'other-assignment'},
 {...goodActor,ownerID:999},
 {...goodActor,characterID:500},
 {...goodActor,pilotCharacterID:500},
 {...goodActor,session:{characterID:500}},
 {...goodActor,session:{}},
 {...goodActor,session:{characterID:0}},
 {...goodActor,selectionID:null},
])deny(actor);
// Ordinary native NPC behavior remains unchanged by PF-only fences.
r=run({itemID:1002,kind:'ship'},ordinary,ordinary);
assert.equal(r.result.success,true);assert.equal(r.register,1);assert.equal(r.auth,0);
assert.equal(cases,17);
console.log('PF72 17 existing-actor identity scenarios PASS');
'''

class PF72ExistingActor(unittest.TestCase):
    def test_guard_follows_exact_original_existing_entity_read(self):
        src=B.transform(PF71.SOURCE)
        anchor='  const existingEntity = scene.getEntityByID(entityRecord.entityID);'
        guard='PF72: never hijack a physical player/foreign actor'
        effect='  const controller = registerNativeRuntimeController'
        self.assertEqual(src.count(anchor),1)
        self.assertEqual(src.count(guard),1)
        self.assertLess(src.index(anchor),src.index(guard))
        self.assertLess(src.index(guard),src.index(effect))
        self.assertEqual(src.count('function pf58OriginalExistingSceneActorValid('),1)

    def test_guard_denies_foreign_actor_without_controller_side_effect(self):
        with tempfile.TemporaryDirectory(prefix='pf72-') as root:
            root=Path(root)
            (root/'patched.js').write_text(B.transform(PF71.SOURCE))
            (root/'check.cjs').write_text(NODE)
            r=subprocess.run(['node',str(root/'check.cjs'),str(root/'patched.js')],
                             capture_output=True,text=True,timeout=20)
            self.assertEqual(r.returncode,0,r.stdout+'\n'+r.stderr)
            self.assertIn('17 existing-actor identity scenarios PASS',r.stdout)

    def test_source_drift_refused_not_skipped(self):
        src=PF71.SOURCE.replace('  if (existingEntity) {', '  if (alreadyThere) {')
        with self.assertRaisesRegex(ValueError,'PF58_NATIVE_ANCHOR_DRIFT'):
            B.transform(src)

if __name__=='__main__':unittest.main()
