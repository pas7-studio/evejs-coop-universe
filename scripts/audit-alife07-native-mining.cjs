"use strict";
// Read-only ALIFE-07 native SQLite receipt/source/cargo audit.
// Never repairs, modifies, replaces or bootstraps the game world.
const fs=require("node:fs");
const path=require("node:path");
const SEP="\u001f";
function inspect(file,DatabaseSync){
 const full=path.resolve(file);
 if(!fs.existsSync(full)||!fs.statSync(full).isFile())
  throw Error("ALIFE07_SQLITE_FILE_REQUIRED");
 const db=new DatabaseSync(full,{readOnly:true});
 try{
  const read=(t,key)=>{
   const row=db.prepare('SELECT json FROM "'+t+'" WHERE key=?').get(key);
   return row?JSON.parse(row.json):null;
  };
  const receipts=db.prepare('SELECT key,json FROM "miningRuntimeState" WHERE key LIKE ?')
    .all("coopMiningCycle:%").map(x=>({key:x.key,...JSON.parse(x.json)}));
  const cargo=read("npcCargo","cargo")||{};
  const anomalies=[];
  const totals={receipts:receipts.length,unitsCredited:0,resourceUnitsRemoved:0,
   stillInMiner:0,movedOrMissing:0,issues:0};
  const seen=new Set();
  for(const receipt of receipts){
   if(seen.has(receipt.key))anomalies.push({key:receipt.key,reason:"DUPLICATE_OPERATION"});
   seen.add(receipt.key);
   const src=read("miningRuntimeState","systems"+SEP+receipt.systemID)
     ?.entities?.[String(receipt.rockID)];
   if(receipt.status!=="COMMITTED"||!src ||
      Number(src.yieldTypeID)!==Number(receipt.oreTypeID) ||
      Number(src.remainingQuantity)>Number(receipt.afterRock))
     anomalies.push({key:receipt.key,reason:"SOURCE_RECEIPT_CONFLICT"});
   const noOre=Number(receipt.quantity)===0;
   const row=noOre?null:(cargo[String(receipt.cargoID)]||null);
   if(row && (Number(row.ownerID)!==Number(receipt.ownerID) ||
       Number(row.typeID)!==Number(receipt.oreTypeID) ||
       Number(row.entityID)!==Number(receipt.shipID) ||
       Number(row.quantity)<Number(receipt.nextCargo)))
     anomalies.push({key:receipt.key,reason:"CARGO_RECEIPT_CONFLICT"});
   if(noOre){} // Waste-only native source debit; no cargo was ever created.
   else if(row)totals.stillInMiner++;
   else totals.movedOrMissing++; // Requires separate native hauler/warehouse custody proof.
   totals.unitsCredited+=Number(receipt.quantity)||0;
   totals.resourceUnitsRemoved+=(Number(receipt.normal)||0)+(Number(receipt.wasted)||0);
  }
  totals.issues=anomalies.length;
  return {status:anomalies.length?"NEEDS_OPERATOR_REVIEW":"RECEIPTS_READABLE",
    path:full,readonly:true,totals,anomalies,
    note:"Missing miner cargo may reflect real native hauling. Verify #110 native custody before claiming loss or credit."};
 }finally{db.close();}
}
if(require.main===module){
 const filename=process.argv[2];
 if(!filename){console.error("Usage: node scripts/audit-alife07-native-mining.cjs <disposable-gamestore.sqlite>");process.exitCode=2;}
 else try{
  const {DatabaseSync}=require("node:sqlite");
  const report=inspect(filename,DatabaseSync);
  console.log(JSON.stringify(report,null,2));
  if(report.totals.issues)process.exitCode=1;
 }catch(error){console.error(String(error.message||error));process.exitCode=2;}
}
module.exports={inspect};
