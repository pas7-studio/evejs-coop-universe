import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT=Path(__file__).resolve().parents[1]/'build_native_owner_patch.py'
spec=importlib.util.spec_from_file_location('pf55builder',SCRIPT)
builder=importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

ARB='''"use strict";
const OWNERS = new Set(["RAID","TACTICS","GATE","PATROL","CIVILIAN","WAR","EXPEDITION"]);
function eligible(existing,pilotID,owner) {
  if(!existing) return true;
  if(existing.phase !== "ACTIVE") return false;
  if(existing.pilotID !== pilotID) return false;
  if(existing.owner === owner) return true;
  // Only the genuinely emergency-capable native tactics director can preempt.
  return owner === "TACTICS";
}
'''
BRIDGE='''"use strict";
function createOrderBridge({arbiter, assignments, sceneForSystem, getController,
 warShipClaim=null}={}) {
 if(warShipClaim!==null&&typeof warShipClaim!=="function")throw Error("WAR_SHIP_CLAIM_AUTHORITY_INVALID");
 function nativePermits(link,owner,action) {
  // Even emergency tactics cannot override an in-flight native Destiny warp.
  return {success:true};
 }
 function diagnose({entityID,systemID,owner="RAID"}={}){
  const warOwnsItsPatrol=owner==="WAR"&&warClaim==="ASSIGNED"&&!state.manualBusy;
  const reason=state.warp?"COOP_NPC_ORDER_NATIVE_WARP_ACTIVE":"";
 }
}
'''

class PatchTests(unittest.TestCase):
 def test_exact_arbiter_anchors(self):
  out=builder.change(ARB,'coopNpcOrderArbiter.js')
  self.assertIn('"PERSONAL_FLEET"',out)
  self.assertIn('if(existing.owner === "PERSONAL_FLEET") return false',out)
 def test_exact_bridge_anchors(self):
  out=builder.change(BRIDGE,'coopNpcOrderBridge.js')
  self.assertIn('pfShipClaim=null',out)
  self.assertIn('PF55_NATIVE_ACTOR_CLAIM_UNVERIFIED',out)
  self.assertIn('PF55_NATIVE_ACTOR_RESERVED',out)
  self.assertIn('PF55_NATIVE_ACTOR_REGISTRY_INVALID',out)
 def test_missing_anchor_rejected(self):
  with self.assertRaises(ValueError):builder.change('not original','coopNpcOrderBridge.js')
 def test_duplicate_anchor_rejected(self):
  with self.assertRaises(ValueError):builder.change(BRIDGE+BRIDGE,'coopNpcOrderBridge.js')
 def test_synthetic_git_apply_smoke(self):
  originals={'coopNpcOrderArbiter.js':ARB,'coopNpcOrderBridge.js':BRIDGE}
  with tempfile.TemporaryDirectory() as t:
   root=Path(t)
   subprocess.run(['git','init','-q',str(root)],check=True)
   import difflib
   diff=[]
   for name,source in originals.items():
    rel=builder.PREFIX+name
    path=root/rel;path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(source)
    updated=builder.change(source,name)
    diff.extend(difflib.unified_diff(source.splitlines(True),updated.splitlines(True),
      fromfile='a/'+rel,tofile='b/'+rel,n=4))
   patch=''.join(diff)
   subprocess.run(['git','-C',str(root),'apply','--check','-'],input=patch,text=True,check=True)
   self.assertIn('PERSONAL_FLEET',patch)
   subprocess.run(['git','-C',str(root),'apply','-'],input=patch,text=True,check=True)
   self.assertIn('PF55_NATIVE_ACTOR_RESERVED', (root/(builder.PREFIX+'coopNpcOrderBridge.js')).read_text())
 def test_source_sha_pinned_to_inspected_fork(self):
  self.assertEqual(builder.FILES['coopNpcOrderArbiter.js'],'aa5447ada4015b1ac8262d14bae5cd975af6ec6b')
  self.assertEqual(builder.FILES['coopNpcOrderBridge.js'],'c0f93af3e5a67703a84dc03cab8da29a65afdf3b')

if __name__=='__main__':unittest.main()