"use strict";
// Durable receipt of ore actually unloaded from EveJS NPC cargo.
// Does NOT create EveJS market orders or pretend to own station inventory.
const fs=require("node:fs"),path=require("node:path");
const positive=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
function createDepot({file,clock=()=>Date.now()}){
 if(!file)throw Error("depot file required");
 let state={version:1,receipts:{},totals:{}};
 try{
  const saved=JSON.parse(fs.readFileSync(file,"utf8"));
  if(saved?.version!==1||!saved.receipts||!saved.totals)throw Error("bad depot state");
  state=saved;
 }catch(e){if(e.code!=="ENOENT")throw e;}
 const persist=()=>{
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+".tmp-"+process.pid;
  fs.writeFileSync(tmp,JSON.stringify(state));fs.renameSync(tmp,file);
 };
 function record({systemID,fleetID,deliveries=[]}={}){
  if(!positive(systemID)||!positive(fleetID)||!Array.isArray(deliveries))return {status:"INVALID",accepted:0};
  let accepted=0,quantity=0;
  for(const item of deliveries){
   const cargoID=positive(item?.cargoID),typeID=positive(item?.typeID);
   const amount=Number(item?.quantity);
   if(!cargoID||!typeID||!Number.isSafeInteger(amount)||amount<=0||state.receipts[cargoID])continue;
   state.receipts[cargoID]={cargoID,typeID,quantity:amount,
    systemID:Number(systemID),fleetID:Number(fleetID),
    haulerID:positive(item.haulerID),at:clock()};
   quantity+=amount;accepted++;
  }
  if(accepted){
   const key=String(systemID);
   state.totals[key]=Math.min(Number.MAX_SAFE_INTEGER,(state.totals[key]||0)+quantity);
   persist();
  }
  return {status:accepted?"RECORDED":"ALREADY_RECORDED",accepted,quantity};
 }
 return {record,snapshot:()=>structuredClone(state)};
}
let nativeDepot=null;
function getNativeDepot(){
 if(!nativeDepot)nativeDepot=createDepot({
  file:process.env.EVEJS_COOP_DEPOT_FILE||"/var/lib/evejs/coop-native-depot.json"
 });
 return nativeDepot;
}
module.exports={createDepot,getNativeDepot};
