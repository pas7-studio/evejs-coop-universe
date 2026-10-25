"use strict";
/**
 * Opt-in, source-first native NPC weapon-bank debit.
 *
 * The entire native npcCargo cargo map and all module replay fences are changed
 * in ONE SQLite BEGIN IMMEDIATE transaction via the existing GameStore owner.
 * A separately fsynced ship-wide PREPARED/COMMITTED journal fences crashes,
 * but is NOT a transaction with damage, missiles, or the JavaScript scene.
 */
const fs=require("node:fs");
const path=require("node:path");
const pos=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
const boundary=v=>typeof v==="number"&&Number.isFinite(v)&&v>0;
let sequence=0;
const maxReceiptBytes=16384;
const gate=env=>env.EVEJS_COOP_NPC_STRICT_AMMO==="1"&&
 env.EVEJS_COOP_NPC_AMMO_DURABLE_CYCLE==="1"&&
 env.EVEJS_COOP_NPC_BANK_ATOMIC==="1"&&
 env.EVEJS_COOP_NATIVE_ATOMIC_ROWS==="1";
function journalFile(root,entityID){return path.join(root,"bank-ships",String(entityID)+".json");}
function readReceipt(file,io=fs){
 let raw;
 try{raw=io.readFileSync(file,"utf8");}
 catch(e){if(e.code==="ENOENT")return null;throw e;}
 if(typeof raw!=="string"||raw.length>maxReceiptBytes)throw Error("BANK_RECEIPT_SIZE_INVALID");
 const v=JSON.parse(raw);
 if(v?.version!==1||!["PREPARED","COMMITTED"].includes(v.phase)||
   !pos(v.entityID)||!boundary(v.boundaryMs)||
   !Array.isArray(v.modules)||!v.modules.length||v.modules.length>16||
   v.modules.some(m=>!pos(m))||new Set(v.modules).size!==v.modules.length||
   typeof v.nonce!=="string"||!v.nonce.length)
   throw Error("BANK_RECEIPT_INVALID");
 return v;
}
function inspectShip({root,entityID,io=fs}={}){
 const id=pos(entityID);
 if(typeof root!=="string"||!path.isAbsolute(root)||!id)return {ok:false,status:"BANK_JOURNAL_INVALID"};
 const file=journalFile(root,id),dir=path.dirname(file);
 try{
  if(!io.existsSync(dir))return {ok:true,status:"EMPTY"};
  const stat=io.lstatSync(dir);
  if(!stat.isDirectory()||stat.isSymbolicLink())return {ok:false,status:"BANK_DIRECTORY_UNSAFE"};
  const names=io.readdirSync(dir);
  if(names.some(n=>n.startsWith(String(id)+".json.tmp-")))
   return {ok:false,status:"BANK_ORPHAN_TEMP"};
  if(io.existsSync(file+".lock"))return {ok:false,status:"BANK_LOCKED_RECONCILE"};
  const receipt=readReceipt(file,io);
  if(!receipt)return {ok:true,status:"EMPTY"};
  if(receipt.entityID!==id)return {ok:false,status:"BANK_IDENTITY_MISMATCH"};
  if(receipt.phase==="PREPARED")return {ok:false,status:"BANK_NEEDS_RECONCILIATION"};
  return {ok:true,status:"COMMITTED",receipt};
 }catch(_){return {ok:false,status:"BANK_JOURNAL_CORRUPT"};}
}
function syncDir(io,dir){
 const fd=io.openSync(dir,"r");
 try{io.fsyncSync(fd);}finally{io.closeSync(fd);}
}
function writeAtomic(io,file,receipt){
 const dir=path.dirname(file),bytes=JSON.stringify(receipt);
 if(bytes.length>maxReceiptBytes)throw Error("BANK_RECEIPT_TOO_LARGE");
 const tmp=file+".tmp-"+String(process.pid)+"-"+String(++sequence);
 let fd=null;
 try{
  fd=io.openSync(tmp,"wx",0o600);
  io.writeFileSync(fd,bytes);
  io.fsyncSync(fd);
  io.closeSync(fd);fd=null;
  io.renameSync(tmp,file);
  syncDir(io,dir);
 }finally{if(fd!==null)try{io.closeSync(fd);}catch(_){}}
}
function prepare(io,root,entityID,modules,whenMs,clock){
 const status=inspectShip({root,entityID,io});
 if(!status.ok)throw Error(status.status);
 const dir=path.join(root,"bank-ships");
 const rootStat=io.lstatSync(root);
 if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw Error("BANK_ROOT_UNSAFE");
 try{io.mkdirSync(dir,{mode:0o700});}
 catch(e){if(e.code!=="EEXIST")throw e;}
 const dirStat=io.lstatSync(dir);
 if(!dirStat.isDirectory()||dirStat.isSymbolicLink())throw Error("BANK_DIRECTORY_UNSAFE");
 syncDir(io,root);
 const file=journalFile(root,entityID),lock=file+".lock";
 const nonce=String(process.pid)+":"+String(clock())+":"+String(++sequence);
 const fd=io.openSync(lock,"wx",0o600);
 try{
  io.writeFileSync(fd,JSON.stringify({version:1,entityID,nonce}));
  io.fsyncSync(fd);
 }finally{io.closeSync(fd);}
 syncDir(io,dir);
 const state=readReceipt(file,io);
 if((state?.nonce||null)!==(status.receipt?.nonce||null))
  throw Error("BANK_JOURNAL_RACE");
 const receipt={version:1,phase:"PREPARED",entityID,boundaryMs:whenMs,
  modules:[...modules].sort((a,b)=>a-b),nonce};
 writeAtomic(io,file,receipt);
 return {file,lock,receipt};
}
function settle(io,token){
 const owner=JSON.parse(io.readFileSync(token.lock,"utf8"));
 if(owner?.entityID!==token.receipt.entityID||owner?.nonce!==token.receipt.nonce)
  throw Error("BANK_LOCK_CHANGED");
 const old=readReceipt(token.file,io);
 if(old?.phase!=="PREPARED"||old.nonce!==token.receipt.nonce)
  throw Error("BANK_JOURNAL_CHANGED");
 writeAtomic(io,token.file,{...old,phase:"COMMITTED"});
 io.unlinkSync(token.lock);
 syncDir(io,path.dirname(token.file));
}
function createAtomicAmmoBank({root,atomicRows,store,compatible,io=fs,clock=()=>Date.now()}={}){
 if(typeof root!=="string"||!path.isAbsolute(root)||
   typeof atomicRows?.transact!=="function"||
   typeof store?.listNativeCargoForEntity!=="function"||
   typeof compatible!=="function"||typeof clock!=="function")
  throw Error("BANK_ATOMIC_DEPENDENCIES_REQUIRED");
 function consume({entity,entries,whenMs}={}){
  const fail=status=>({success:false,errorMsg:status,stopReason:"ammo"});
  const entityID=pos(entity?.itemID),ownerID=pos(entity?.ownerID);
  if(entity?.kind!=="ship"||entity?.nativeNpc!==true||!entityID||!ownerID||
    !boundary(whenMs)||!Array.isArray(entries)||entries.length<1||entries.length>16||
    entity.session)return fail("BANK_ATOMIC_INVALID_IDENTITY");
  const seenModules=new Set(),seenCargo=new Set(),expected=[];
  for(const e of entries){
   const moduleID=pos(e?.moduleItem?.itemID),cargoID=pos(e?.chargeItem?.itemID),
    typeID=pos(e?.chargeItem?.typeID),amount=Number(e?.quantity||1),
    qty=Number(e?.chargeItem?.quantity??e?.chargeItem?.stacksize);
   if(!moduleID||!cargoID||!typeID||seenModules.has(moduleID)||
      seenCargo.has(cargoID)||amount!==1||!Number.isSafeInteger(qty)||qty<1)
    return fail("BANK_ATOMIC_BAD_MANIFEST");
   seenModules.add(moduleID);seenCargo.add(cargoID);
   expected.push({moduleID,cargoID,typeID,flagID:Number(e.moduleItem.flagID),
    moduleTypeID:pos(e.moduleItem.typeID),qty,original:e.chargeItem});
  }
  let token;
  try{token=prepare(io,root,entityID,seenModules,whenMs,clock);}
  catch(_){return fail("BANK_ATOMIC_JOURNAL_UNSAFE");}
  let updated;
  try{
   updated=atomicRows.transact(["npcEntities","npcModules","npcCargo"],tx=>{
    const ship=tx.get("npcEntities","entities\u001f"+String(entityID));
    if(!ship||Number(ship.ownerID)!==ownerID||!pos(ship.systemID))
     throw Error("BANK_NATIVE_SHIP_CHANGED");
    const cargo=tx.get("npcCargo","cargo");
    if(!cargo||typeof cargo!=="object"||Array.isArray(cargo))
     throw Error("BANK_NATIVE_CARGO_UNAVAILABLE");
    const fenceKey="coopAmmoCycles_"+String(entityID);
    const previousFence=tx.get("npcCargo",fenceKey);
    if(previousFence!==null&&(previousFence?.version!==1||
       previousFence.entityID!==entityID||
       !previousFence.modules||typeof previousFence.modules!=="object"||
       Array.isArray(previousFence.modules)))
     throw Error("BANK_NATIVE_FENCE_CORRUPT");
    const fences={...(previousFence?.modules||{})};
    const next={...cargo};
    const result=[];
    for(const part of expected){
     const fitted=tx.get("npcModules","modules\u001f"+String(part.moduleID));
     const row=next[String(part.cargoID)];
     if(!fitted||Number(fitted.moduleID)!==part.moduleID||
       Number(fitted.entityID)!==entityID||
       Number(fitted.ownerID)!==ownerID||
       Number(fitted.categoryID)!==7||
       Number(fitted.flagID)!==part.flagID||
       (part.moduleTypeID&&Number(fitted.typeID)!==part.moduleTypeID)||
       compatible(fitted,part.typeID)!==true)
      throw Error("BANK_NATIVE_MODULE_CHANGED");
     if(!row||Number(row.cargoID)!==part.cargoID||
       Number(row.entityID)!==entityID||
       Number(row.moduleID)!==part.moduleID||
       Number(row.ownerID)!==ownerID||
       Number(row.typeID)!==part.typeID||
       Number(row.categoryID)!==8||
       Number(row.flagID)!==part.flagID||
       Number(row.quantity)!==part.qty||
       row.transient===true)
      throw Error("BANK_NATIVE_CARGO_STALE");
     const last=Number(fences[String(part.moduleID)]||0);
     if(!Number.isFinite(last)||last>=whenMs)
      throw Error("BANK_NATIVE_CYCLE_REPLAY");
     const remaining=part.qty-1;
     if(remaining>0)next[String(part.cargoID)]={...row,quantity:remaining};
     else delete next[String(part.cargoID)];
     fences[String(part.moduleID)]=whenMs;
     result.push({moduleID:part.moduleID,cargoID:part.cargoID,
      typeID:part.typeID,previousQuantity:part.qty,nextQuantity:remaining});
    }
    if(Object.keys(fences).length>2048)
     throw Error("BANK_NATIVE_FENCE_LIMIT");
    tx.put("npcCargo","cargo",next);
    tx.put("npcCargo",fenceKey,{version:1,entityID,modules:fences});
    return result;
   });
  }catch(_){return fail("BANK_ATOMIC_TRANSACTION_UNCERTAIN");}
  // Re-read real post-transaction GameStore state before marking the
  // separate POSIX journal COMMITTED. Unknown state never retries/refunds.
  try{
   const rows=store.listNativeCargoForEntity(entityID);
   if(!Array.isArray(rows))return fail("BANK_ATOMIC_READBACK_UNSAFE");
   for(const row of updated){
    const actual=rows.filter(x=>Number(x.cargoID)===row.cargoID);
    if(row.nextQuantity===0?actual.length!==0:
      actual.length!==1||Number(actual[0].quantity)!==row.nextQuantity||
       Number(actual[0].ownerID)!==ownerID||
       Number(actual[0].moduleID)!==row.moduleID||
       Number(actual[0].typeID)!==row.typeID)
     return fail("BANK_ATOMIC_READBACK_MISMATCH");
   }
   settle(io,token);
  }catch(_){return fail("BANK_ATOMIC_SETTLEMENT_UNSAFE");}
  // Only after verified native persistence AND durable commit do we touch
  // the in-scene NPC cargo cache. Never spawn projectiles from this module.
  const byCargo=new Map(updated.map(r=>[r.cargoID,r]));
  if(Array.isArray(entity.nativeCargoItems)){
   entity.nativeCargoItems=entity.nativeCargoItems.flatMap(item=>{
    const r=byCargo.get(Number(item?.itemID));
    if(!r)return [item];
    return r.nextQuantity>0?[{...item,quantity:r.nextQuantity,
      stacksize:r.nextQuantity}]:[];
   });
  }
  return {success:true,results:updated.map(r=>{
   const part=expected.find(e=>e.moduleID===r.moduleID);
   const chargeItem=r.nextQuantity>0
    ? {...part.original,quantity:r.nextQuantity,stacksize:r.nextQuantity}
    : null;
   return {moduleID:r.moduleID,result:{
    success:true,
    data:{chargeItem,previousQuantity:r.previousQuantity,
     nextQuantity:r.nextQuantity,depleted:r.nextQuantity===0},
    stopReason:r.nextQuantity===0?"ammo":null
   }};
  })};
 }
 return {consume};
}
function consumeBank(args){
 if(!gate(process.env))
  return {success:false,errorMsg:"BANK_ATOMIC_FLAG_INCOMPLETE",stopReason:"ammo"};
 try{
  const gameStore=require("../gameStore");
  const store=require("./npc/nativeNpcStore");
  const compatible=require("./npc/npcCapabilityResolver").isNpcChargeCompatibleWithModule;
  const root=process.env.EVEJS_COOP_NPC_AMMO_DEBIT_ROOT||
   "/var/lib/evejs/coop-npc-ammo-debits";
  return createAtomicAmmoBank({root,atomicRows:gameStore.coopAtomicNativeRows,
   store,compatible}).consume(args);
 }catch(_){return {success:false,errorMsg:"BANK_ATOMIC_UNAVAILABLE",stopReason:"ammo"};}
}
module.exports={createAtomicAmmoBank,inspectShip,consumeBank,gate};
