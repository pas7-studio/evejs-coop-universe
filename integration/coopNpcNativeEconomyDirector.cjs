"use strict";
// COOP-033: provenance-first NPC factory -> native sale -> measured replenishment.
// Synchronous, single-station manual driver. No worker, timer, inventory mint,
// wallet credit, seed order rewrite, API endpoint, or live registration.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const STATES=new Set(["PREPARED","INSTALL_UNKNOWN","INSTALLED","READY","DELIVERY_UNKNOWN","DELIVERED","LIST_UNKNOWN","LISTED","SOLD","REPAIR_REQUIRED"]);
const safeInt=x=>Number.isSafeInteger(x)&&x>0;
const cents=x=>Number.isFinite(x)&&x>=0&&x<=1e12&&Number.isSafeInteger(Math.round(x*100))?Math.round(x*100):null;
const copy=x=>JSON.parse(JSON.stringify(x));
const isOperation=x=>typeof x==="string"&&/^npc-manufacture:[0-9a-f]{32}$/.test(x);
const closed=x=>x==="SOLD";
function createDirector({file,planner,native,market,observe,clock=()=>Date.now(),maxActive=2,maxStock=50000,minReorderMs=60000}={}){
 if(typeof file!=="string"||!path.isAbsolute(file)||!planner||typeof planner.plan!=="function"||
  !native||["quote","installOnce","markReadyOnce","deliverOnce","getJob","getItem","getIndustryDebit"].some(k=>typeof native[k]!=="function")||
  !market||["listOnce","getOrder","getSaleEvidence","getWalletEntry"].some(k=>typeof market[k]!=="function")||
  !observe||["getOwner","getStation","snapshot"].some(k=>typeof observe[k]!=="function")||
  typeof clock!=="function"||!Number.isSafeInteger(maxActive)||maxActive<1||maxActive>2||
  !Number.isSafeInteger(maxStock)||maxStock<1||maxStock>1000000||
  !Number.isSafeInteger(minReorderMs)||minReorderMs<10000)throw Error("NPC_ECONOMY_NATIVE_AUTHORITIES_REQUIRED");
 const lock=file+".lock";
 function load(){try{const state=JSON.parse(fs.readFileSync(file,"utf8"));
  if(state?.version!==1||!state.entries||typeof state.entries!=="object"||Array.isArray(state.entries)||
     !state.history||typeof state.history!=="object")throw Error("NPC_ECONOMY_JOURNAL_CORRUPT");
  for(const [id,e] of Object.entries(state.entries))if(!isOperation(id)||e.operationID!==id||!STATES.has(e.phase))
    throw Error("NPC_ECONOMY_JOURNAL_CORRUPT");return state;
 }catch(e){if(e.code==="ENOENT")return {version:1,entries:{},history:{}};throw e;}}
 function save(state){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+".tmp-"+process.pid+"-"+crypto.randomUUID();let fd;
  try{fd=fs.openSync(tmp,"wx",0o600);fs.writeFileSync(fd,JSON.stringify(state));fs.fsyncSync(fd);fs.closeSync(fd);fd=null;
   fs.renameSync(tmp,file);try{const d=fs.openSync(path.dirname(file),"r");try{fs.fsyncSync(d)}finally{fs.closeSync(d)}}
   catch(e){if(process.platform!=="win32"||!["EPERM","EINVAL","ENOTSUP","EBADF","EISDIR"].includes(e.code))throw e;}}
  finally{if(fd!==null&&fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp)}catch(e){if(e.code!=="ENOENT")throw e}}}
 function exclusive(fn){fs.mkdirSync(path.dirname(file),{recursive:true});let fd;
  try{fd=fs.openSync(lock,"wx",0o600)}catch{return {status:"ECONOMY_LOCKED"}};
  const release=()=>{fs.closeSync(fd);try{fs.unlinkSync(lock)}catch{}};
  try{const result=fn();if(result&&typeof result.then==="function")return result.finally(release);
   release();return result;
  }catch(error){release();throw error;}}
 function halt(reason,operationID){return {status:"BLOCKED",reason,operationID}}
 function validateContext(ownerID,stationID){if(!safeInt(ownerID)||!safeInt(stationID))return false;
  const o=observe.getOwner(ownerID),s=observe.getStation(stationID);
  return Boolean(o&&o.corporationID===ownerID&&o.isNpc===true&&
   s&&s.stationID===stationID&&safeInt(s.solarSystemID));}
 function snapshot(ownerID,stationID){const s=observe.snapshot(ownerID,stationID);
  if(!s||s.authoritativeNative!==true||s.ownerID!==ownerID||s.stationID!==stationID||
    !Array.isArray(s.items)||!Array.isArray(s.orders)||!Array.isArray(s.jobs)||
    !s.targets||typeof s.targets!=="object"||!Array.isArray(s.demandReceipts))throw Error("NATIVE_ECONOMY_SNAPSHOT_UNVERIFIED");
  for(const v of [...s.items,...s.orders,...s.jobs])if(!v||!safeInt(v.typeID)||!Number.isSafeInteger(v.quantity)||v.quantity<0)
    throw Error("NATIVE_ECONOMY_NEGATIVE_QUANTITY");
  for(const v of s.demandReceipts)if(!v||!safeInt(v.typeID)||!Number.isSafeInteger(v.quantity)||v.quantity<1||
    !v.authoritativeNative||!v.receiptID||!Number.isSafeInteger(v.at)||
    !["NATIVE_MARKET_FILL","NATIVE_WEAPON_CONSUMPTION","NATIVE_NPC_PURCHASE"].includes(v.source)||
    v.ownerID!==ownerID||v.stationID!==stationID)throw Error("NATIVE_ECONOMY_DEMAND_NOT_ATTESTED");
  if(s.demandReceipts.length>2000||new Set(s.demandReceipts.map(x=>x.receiptID)).size!==s.demandReceipts.length)
    throw Error("NATIVE_ECONOMY_DEMAND_RECEIPT_REPLAY");
  return s;
 }
 function demand(s,typeID){const base=s.targets[String(typeID)];if(!Number.isSafeInteger(base)||base<0||base>maxStock)
   throw Error("NATIVE_ECONOMY_TARGET_INVALID");
  const consumed=s.demandReceipts.filter(x=>x.typeID===typeID&&clock()-x.at>=0&&clock()-x.at<=86400000)
   .reduce((sum,x)=>sum+x.quantity,0);
  if(!Number.isSafeInteger(consumed))throw Error("NATIVE_ECONOMY_CONSUMPTION_OVERFLOW");
  // Consumption raises replenishment only within a policy cap; never creates items or ISK.
  const target=Math.min(maxStock,base+Math.min(base*2,consumed));
  // Only count actual corporate station items, owned escrow and unfinished jobs.
  const sum=(rows,field)=>rows.filter(x=>x.typeID===typeID&&x.ownerID===s.ownerID&&x.stationID===s.stationID)
    .reduce((a,x)=>a+x[field],0);
  const stored=sum(s.items,"quantity"),listed=sum(s.orders,"quantity"),inFlight=sum(s.jobs,"quantity");
  const total=stored+listed+inFlight;
  if(!Number.isSafeInteger(total)||total<0||total>Number.MAX_SAFE_INTEGER)throw Error("NATIVE_ECONOMY_STOCK_INVALID");
  return {target,stored,listed,inFlight,shortage:Math.max(0,target-total)};
 }
 function receipt(job,r){return Boolean(job&&r&&safeInt(job.jobID)&&job.coopOperationID===r.operationID&&
  job.status===4&&r.jobID===job.jobID&&r.status==="DELIVERED"&&safeInt(r.itemID)&&
  Number.isSafeInteger(r.quantity)&&r.quantity>0&&
  r.quantity===job.coopDelivery?.quantity&&r.itemID===job.coopDelivery?.itemID);
 }
 function stepEntry(state,e,ownerID,stationID){const id=e.operationID;
  if(e.ownerID!==ownerID||e.stationID!==stationID)return halt("OPERATION_STATION_IDENTITY_MISMATCH",id);
  if(["INSTALL_UNKNOWN","DELIVERY_UNKNOWN","LIST_UNKNOWN","REPAIR_REQUIRED"].includes(e.phase))return halt("OUTCOME_UNKNOWN_OPERATOR_RECONCILIATION",id);
  const job=()=>native.getJob(id);
  if(e.phase==="PREPARED"){
   const q=native.quote(e.plan);
   if(!q||q.verifiedNative!==true||cents(q.totalCost)===null||q.ownerID!==ownerID||
     q.blueprintID!==e.plan.blueprintItemID||q.productTypeID!==e.typeID||q.facilityID!==stationID)
    return halt("UNVERIFIED_CANONICAL_QUOTE",id);
   e.phase="INSTALL_UNKNOWN";e.quote=copy(q);save(state);
   const r=native.installOnce(e.plan,q,id),j=job();
   if(!["INSTALLED","ALREADY_INSTALLED"].includes(r?.status)||!safeInt(r.jobID)||
      j?.jobID!==r.jobID||j?.ownerID!==ownerID||j?.coopOperationID!==id||
      j?.productTypeID!==e.typeID||j?.blueprintID!==e.plan.blueprintItemID)
      return halt("INSTALL_OUTCOME_UNKNOWN",id);
   const debit=native.getIndustryDebit(j.jobID);
   if(!debit||debit.verifiedNative!==true||debit.ownerID!==ownerID||debit.jobID!==j.jobID||
      debit.amountCents!==cents(q.totalCost))return halt("NATIVE_INDUSTRY_ISK_DEBIT_UNVERIFIED",id);
   e.phase="INSTALLED";e.jobID=j.jobID;e.installCostCents=cents(q.totalCost);save(state);
   return {status:"INSTALLED",operationID:id,jobID:j.jobID};
  }
  if(e.phase==="INSTALLED"){
   const j=job();if(j?.jobID!==e.jobID||j.ownerID!==ownerID||j.coopOperationID!==id)return halt("JOB_IDENTITY_CHANGED",id);
   if(j.status===1){const r=native.markReadyOnce(id);
    if(r?.status==="BLOCKED"&&/NOT_YET_READY/.test(String(r.error)))return {status:"WAITING_FOR_NATIVE_TIMER",operationID:id};
    if(!["READY","ALREADY_READY"].includes(r?.status))return halt("NATIVE_READY_NOT_VERIFIED",id);
   }else if(j.status!==3)return halt("NATIVE_JOB_STATUS_INVALID",id);
   if(job()?.status!==3)return halt("NATIVE_READY_NOT_PERSISTED",id);
   e.phase="READY";save(state);return {status:"READY",operationID:id};
  }
  if(e.phase==="READY"){
   if(job()?.status!==3)return halt("NATIVE_READY_NOT_PERSISTED",id);
   e.phase="DELIVERY_UNKNOWN";save(state);
   const r=native.deliverOnce(id),j=job();
   if(!receipt(j,{...r,operationID:id,jobID:e.jobID}))return halt("DELIVERY_OUTCOME_UNKNOWN",id);
   const item=native.getItem(r.itemID);
   if(!item||item.itemID!==r.itemID||item.typeID!==e.typeID||item.ownerID!==ownerID||
      item.locationID!==stationID||item.quantity!==r.quantity||
      item.customInfo!=="coop-industry:v1:"+e.jobID)return halt("DELIVERY_ITEM_IDENTITY_UNKNOWN",id);
   e.phase="DELIVERED";e.itemID=item.itemID;e.quantity=item.quantity;save(state);
   return {status:"DELIVERED",operationID:id,itemID:e.itemID,quantity:e.quantity};
  }
  if(e.phase==="DELIVERED"){
   const item=native.getItem(e.itemID);
   if(!item||item.ownerID!==ownerID||item.locationID!==stationID||item.typeID!==e.typeID||
      item.quantity!==e.quantity||item.customInfo!=="coop-industry:v1:"+e.jobID)
      return halt("NATIVE_OUTPUT_NO_LONGER_AVAILABLE",id);
   e.phase="LIST_UNKNOWN";save(state);
   const rpc=market.listOnce({operationID:id,ownerID,stationID,itemID:e.itemID,typeID:e.typeID,quantity:e.quantity});
   const verified=r=>{
   const order=r?.orderID?market.getOrder(r.orderID):null;
   if(r?.status!=="LISTED"||!safeInt(r.orderID)||!order||order.orderID!==r.orderID||
      order.ownerID!==ownerID||order.stationID!==stationID||order.typeID!==e.typeID||
      order.sourceItemID!==e.itemID||order.originalQuantity!==e.quantity||
      order.nativeEscrowVerified!==true)return halt("NATIVE_MARKET_LIST_OUTCOME_UNKNOWN",id);
   e.phase="LISTED";e.orderID=r.orderID;e.priceCents=cents(order.price);
   if(e.priceCents===null)return halt("NATIVE_MARKET_PRICE_INVALID",id);
   save(state);return {status:"LISTED",operationID:id,orderID:e.orderID};
   };
   return rpc&&typeof rpc.then==="function"?rpc.then(verified):verified(rpc);
  }
  if(e.phase==="LISTED"){
   const order=market.getOrder(e.orderID),sales=market.getSaleEvidence(e.orderID);
   if(!order||order.orderID!==e.orderID||order.ownerID!==ownerID||
      order.nativeEscrowVerified!==true||!Array.isArray(sales))return halt("NATIVE_SALE_EVIDENCE_MISSING",id);
   if(!Number.isSafeInteger(order.remainingQuantity)||order.remainingQuantity<0||
      order.remainingQuantity>e.quantity)return halt("NATIVE_SALE_REMAINING_INVALID",id);
   const filled=sales.reduce((sum,x)=>{
    if(!x||x.orderID!==e.orderID||x.ownerID!==ownerID||x.typeID!==e.typeID||
       !safeInt(x.quantity)||!safeInt(x.transactionID)||cents(x.price)===null||x.nativeWalletSettled!==true)
       throw Error("NATIVE_SALE_LEDGER_INVALID");
    const wallet=market.getWalletEntry(x.transactionID),expected=cents(x.price)*x.quantity;
    if(!wallet||wallet.verifiedNative!==true||wallet.transactionID!==x.transactionID||
       wallet.ownerID!==ownerID||wallet.orderID!==e.orderID||wallet.amountCents!==expected)
       throw Error("NATIVE_SALE_WALLET_NOT_SETTLED");
    return sum+x.quantity;
   },0);
   if(new Set(sales.map(x=>x.transactionID)).size!==sales.length||filled+order.remainingQuantity!==e.quantity)
    return halt("NATIVE_MARKET_QUANTITY_NOT_CONSERVED",id);
   if(filled===0)return {status:"LISTED_AWAITING_BUYER",operationID:id};
   if(order.remainingQuantity>0)return {status:"PARTIALLY_SOLD",operationID:id,filled,remaining:order.remainingQuantity};
   const revenue=sales.reduce((sum,x)=>sum+cents(x.price)*x.quantity,0);
   if(!Number.isSafeInteger(revenue)||revenue<0)return halt("NATIVE_SALE_REVENUE_INVALID",id);
   e.phase="SOLD";e.revenueCents=revenue;e.soldQuantity=filled;save(state);
   return {status:"SOLD",operationID:id,revenueCents:revenue,productionCostCents:e.installCostCents};
  }
  return {status:"ALREADY_SOLD",operationID:id};
 }
 function tick({ownerID,stationID,productTypeIDs=[]}={}){
  if(process.env.EVEJS_COOP_NATIVE_NPC_ECONOMY!=="1")return {status:"NPC_ECONOMY_DISABLED"};
  return exclusive(()=>{
   if(!validateContext(ownerID,stationID))return halt("NPC_OWNER_OR_STATION_UNVERIFIED");
   const state=load(),active=Object.values(state.entries).filter(e=>!closed(e.phase)&&e.ownerID===ownerID&&e.stationID===stationID)
     .sort((a,b)=>a.createdAt-b.createdAt||a.operationID.localeCompare(b.operationID));
   if(active.length)return stepEntry(state,active[0],ownerID,stationID);
   if(Object.keys(state.entries).length>50000)return halt("ECONOMY_JOURNAL_CAP_REACHED");
   const s=snapshot(ownerID,stationID);
   const selected=[...new Set(productTypeIDs)].sort((a,b)=>a-b).filter(safeInt);
   if(!selected.length||selected.length>8)return halt("PRODUCT_ALLOWLIST_REQUIRED");
   const shortage={},target={},stock={};
   for(const type of selected){const d=demand(s,type);shortage[type]=d.shortage;target[type]=d.target;stock[type]=d.listed;}
   if(selected.every(t=>!shortage[t]))return {status:"SUFFICIENT_NATIVE_STOCK",shortage};
   const key=ownerID+":"+stationID;
   if(Number.isFinite(state.history[key])&&clock()-state.history[key]<minReorderMs)
    return {status:"NPC_ECONOMY_REORDER_COOLDOWN"};
   const p=planner.plan({ownerID,stationID,productTypeIDs:selected.filter(t=>shortage[t]>0),targetStock:target,
    marketStock:stock,maxJobs:Math.min(maxActive,2)});
   if(p?.status!=="PLAN_READY"||!Array.isArray(p.jobs)||!p.jobs.length)return {status:"NO_NATIVE_FACTORY_JOB",blocked:p?.blocked||[]};
   const j=p.jobs[0];if(!safeInt(j.blueprintItemID)||!safeInt(j.productTypeID)||j.ownerID!==ownerID||
     j.stationID!==stationID||!shortage[j.productTypeID]||j.outputQuantity>maxStock)
     return halt("PLANNER_JOB_CONTEXT_INVALID");
   const operationID="npc-manufacture:"+crypto.randomUUID().replace(/-/g,"");
   state.entries[operationID]={operationID,phase:"PREPARED",ownerID,stationID,typeID:j.productTypeID,
    plan:copy(j),createdAt:clock()};state.history[key]=clock();save(state);
   return {status:"PREPARED",operationID,productTypeID:j.productTypeID,shortage:shortage[j.productTypeID]};
  });
 }
 function inspect(){const s=load();return copy({version:s.version,entries:s.entries,history:s.history});}
 return Object.freeze({tick,inspect,mode:"NATIVE_AUTHORITIES_ONLY",supportsLiveRuntime:false});
}
module.exports={createDirector};
