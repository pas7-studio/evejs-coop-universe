from pathlib import Path
from difflib import unified_diff
root=Path(__file__).parent
native='Code/server/src/space/coopNativeHaulTransferAtomic.js'
iso='Code/server/src/space/coopNativeCargoTransientIsolation.js'
patch=[]
def section(path, changes):
    # Original line numbers: source inspected at 2026-11-05; see source SHA in README.
    patch.extend([f'diff --git a/{path} b/{path}',f'--- a/{path}',f'+++ b/{path}'])
    delta=0
    for line, old, new in changes:
        old_lines=old.splitlines();new_lines=new.splitlines()
        patch.append(f'@@ -{line},{len(old_lines)} +{line+delta},{len(new_lines)} @@')
        patch.extend('-'+s for s in old_lines)
        patch.extend('+'+s for s in new_lines)
        delta+=len(new_lines)-len(old_lines)

section(native,[
 (23, 'function createAtomicHaulMover({gameStore,nativeStore,resolveType,clock=()=>Date.now()}={}){',
     'function createAtomicHaulMover({gameStore,nativeStore,resolveType,clock=()=>Date.now(),'+
     'readMiningLease=null,beginHaulWrite=null,finishHaulWrite=null}={}){'),
 (119, '  const remaining=quantity-movedQuantity;', '''  const remaining=quantity-movedQuantity;
  // PF-50: create a stable durable write reservation BEFORE a partial cargoID
  // allocation. No stock behavior changes with the flag OFF.
  const pfFence=process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_HAUL_WRITE_FENCE==="1";
  const pfOpKey="pf-haul:"+sha([systemID,fleetID,minerID,haulerID,id,sha(before),movedQuantity,partial]);
  if(pfFence){
   if(typeof readMiningLease!=="function"||typeof beginHaulWrite!=="function"||
      typeof finishHaulWrite!=="function")
    return {status:"BLOCKED_OWNERSHIP",reason:"PF50_HANDOFF_NOT_WIRED",quantity:0};
   if(typeof gameStore?.coopAtomicNativeRows?.transact!=="function"||
      gameStore.coopAtomicNativeRows.isPoisoned?.()===true)
    return {status:"BLOCKED_OWNERSHIP",reason:"PF50_ATOMIC_AUTHORITY_UNAVAILABLE",quantity:0};
   let pending;
   try{pending=beginHaulWrite({systemID,minerID,haulerID,writer:"haul_transfer",
       operationID:pfOpKey,opKey:pfOpKey});}
   catch(_error){return {status:"BLOCKED_OWNERSHIP",reason:"PF50_BEGIN_WRITE_FAILED",quantity:0};}
   if(pending?.status!=="PENDING"||pending.operationID!==pfOpKey)
    return {status:"BLOCKED_OWNERSHIP",reason:"PF50_WRITE_PERMIT_UNPROVEN",quantity:0};
  }'''),
 (150, '   outcome=authority.transact(["npcCargo"],tx=>{', '''   outcome=authority.transact(pfFence?["npcCargo","corporationRuntime"]:["npcCargo"],tx=>{
    if(pfFence)require("./coopPersonalFleetHaulTxnGuard")
      .assertHaulWriteAuthorized(tx,{systemID,minerID,haulerID,opKey:pfOpKey},readMiningLease);'''),
 (170, '    return proof;\n   });', '''    return proof;
   },pfFence?{contract:"haul-transfer-pf"}:undefined);'''),
 (198, '   hauler.nativeCargoItems=rebuilt;', '''   hauler.nativeCargoItems=rebuilt;
   // A committed native transfer cannot be compensated after an ambiguous ACK.
   // Ack only after the exact original cargo source and target read back.
   if(pfFence){
    let acknowledged;
    try{acknowledged=finishHaulWrite({systemID,minerID,haulerID,operationID:pfOpKey,
      opKey:pfOpKey,receipt:outcome});}
    catch(_error){return failed(miner,hauler,fleet,"PF50_POSTCOMMIT_ACK_UNKNOWN");}
    if(acknowledged?.status!=="ACKED"||acknowledged.operationID!==pfOpKey)
      return failed(miner,hauler,fleet,"PF50_POSTCOMMIT_ACK_UNPROVEN");
   }'''),
])
# PF-49 must have been applied first. This is *only* an incremental patch.
section(iso,[
 (71,'const CONTRACTS=Object.freeze([HAUL_TRANSFER,MINING_CYCLE,MINING_CYCLE_PF,AMMO_BANK]);', '''// PF-50: PF44 and PF46 ownership rows are read-only within original ALIFE10
// cargo transfer commit. This table combination is never available by accident.
const HAUL_TRANSFER_PF=Object.freeze({
 name:"haul-transfer-pf",
 tables:Object.freeze(["npcCargo","corporationRuntime"]),
 flags:Object.freeze(["EVEJS_COOP_NATIVE_HAUL_TRANSFER_ATOMIC",
  "EVEJS_COOP_PERSONAL_FLEET_NATIVE_HAUL_WRITE_FENCE"]),
 cargoRootWrites:Object.freeze({min:1,max:1}),
 cargoOtherKeys:"receipt",
 journal:null,
});
const CONTRACTS=Object.freeze([HAUL_TRANSFER,MINING_CYCLE,MINING_CYCLE_PF,HAUL_TRANSFER_PF,AMMO_BANK]);'''),
 (138,'    error("PF49_OWNERSHIP_ROWS_READ_ONLY");', '''    error("PF49_OWNERSHIP_ROWS_READ_ONLY");
   if(policy.name==="haul-transfer-pf"&&table==="corporationRuntime")
    error("PF50_OWNERSHIP_ROWS_READ_ONLY");''')
])
newpath='Code/server/src/space/coopPersonalFleetHaulTxnGuard.js'
text=(root/'native'/'coopPersonalFleetHaulTxnGuard.js').read_text()
patch.extend([f'diff --git a/{newpath} b/{newpath}', 'new file mode 100644', '--- /dev/null', f'+++ b/{newpath}'])
lines=text.splitlines()
patch.append(f'@@ -0,0 +1,{len(lines)} @@');patch.extend('+'+s for s in lines)
(root/'patches'/'PF50-native-haul-writer.patch').write_text('\n'.join(patch)+'\n')
print('PF50 patch lines:',len(patch))