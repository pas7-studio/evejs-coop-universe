"use strict";
// Separate pinned Rust overlay (existing JS central installer never modifies Rust).
const fs=require("node:fs"),path=require("node:path");
const {execFileSync}=require("node:child_process");
const PIN="c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f";
const STATE="externalservices/market-server/src/state.rs";
const RPC="externalservices/market-server/src/rpc.rs";
const EXT="externalservices/market-server/src/coop_p2p_market_claim.rs";
const TYPES="// COOP-P2P RUST CLAIM TYPES BEGIN\n#[derive(Debug,Deserialize)]\nstruct CoopP2pClaimParams {\n    #[serde(deserialize_with=\"string_i64::deserialize\")]\n    order_id:i64,\n    cycle:i64,\n    buyer_id:u64,\n    seller_id:u64,\n    volume_before:u64,\n    filled_quantity:u64,\n    price_cents:i64,\n}\n#[derive(Debug,Deserialize)]\nstruct CoopP2pFinishParams {\n    #[serde(deserialize_with=\"string_i64::deserialize\")]\n    order_id:i64,\n    cycle:i64,\n    buyer_id:u64,\n    seller_id:u64,\n}\n#[derive(Debug,Deserialize)]\nstruct CoopP2pQueryParams {\n    #[serde(deserialize_with=\"string_i64::deserialize\")]\n    order_id:i64,\n    cycle:i64,\n}\n#[derive(Debug,Deserialize)]\nstruct CoopP2pReleaseParams {\n    #[serde(deserialize_with=\"string_i64::deserialize\")]\n    order_id:i64,\n    cycle:i64,\n    buyer_id:u64,\n    seller_id:u64,\n    native_receipt_key:String,\n}\n// COOP-P2P RUST CLAIM TYPES END\n";
const ARMS="        // COOP-P2P RUST CLAIM ARMS BEGIN\n        \"ClaimPlayerFill\" => {\n            let p:CoopP2pClaimParams=serde_json::from_value(params)?;\n            Ok(runtime.coop_p2p_claim(p.order_id,p.cycle,p.buyer_id,p.seller_id,\n                p.volume_before,p.filled_quantity,p.price_cents).await?)\n        }\n        \"FinalizePlayerFill\" => {\n            let p:CoopP2pFinishParams=serde_json::from_value(params)?;\n            Ok(runtime.coop_p2p_finalize(p.order_id,p.cycle,p.buyer_id,p.seller_id).await?)\n        }\n        \"GetPlayerFillClaim\" => {\n            let p:CoopP2pQueryParams=serde_json::from_value(params)?;\n            Ok(runtime.coop_p2p_get_claim(p.order_id,p.cycle).await?)\n        }\n        \"ReleasePlayerFill\" => {\n            let p:CoopP2pReleaseParams=serde_json::from_value(params)?;\n            Ok(runtime.coop_p2p_release(p.order_id,p.cycle,p.buyer_id,\n                p.seller_id,p.native_receipt_key).await?)\n        }\n        // COOP-P2P RUST CLAIM ARMS END\n";
const INCLUDE="\n// COOP-P2P RUST CLAIM EXTENSION BEGIN\ninclude!(\"coop_p2p_market_claim.rs\");\n// COOP-P2P RUST CLAIM EXTENSION END\n";
const STOCK_GUARD="    // COOP-P2P STOCK FILL GUARD BEGIN\n    if std::env::var(\"EVEJS_COOP_RUST_P2P_CLAIM\").ok().as_deref()==Some(\"1\") {\n        let native_source=transaction.query_row(\n            \"SELECT source FROM market_orders WHERE order_id=?1\",\n            params![request.order_id],\n            |row|row.get::<_,String>(0)\n        ).optional()?;\n        if native_source.as_deref()==Some(\"player\"){\n            bail!(\"P2P_RUST_PLAYER_ORDER_REQUIRES_IDEMPOTENT_CLAIM\");\n        }\n    }\n    // COOP-P2P STOCK FILL GUARD END\n";
const stockAnchor='    let transaction = connection.transaction()?;\n    if let Some((station_id, type_id)) = try_decode_seed_buy_order_id(request.order_id) {';
function patch(source,which,remove=false){
 if(typeof source!=="string")throw Error("P2P_RUST_SOURCE_REQUIRED");
 const eol=source.includes("\r\n")?"\r\n":"\n";
 let text=source.replace(/\r\n/g,"\n");
 function replace(anchor,insert){
  if(text.includes(insert)){
   if(text.split(insert).length!==2)throw Error("P2P_RUST_DUPLICATE_PATCH");
   if(remove)text=text.replace(insert,"");
  }else if(!remove){
   if(text.split(anchor).length!==2)throw Error("P2P_RUST_ANCHOR_DRIFT");
   text=text.replace(anchor,insert+anchor);
  }
 }
 if(which==="rpc"){
  replace('#[derive(Debug, Deserialize)]\nstruct RpcRequest',TYPES);
  replace('        "FillOrder" =>',ARMS);
 }else if(which==="state"){
  const begin=text.indexOf("fn fill_order_in_db(database_path: &Path, request: FillOrderRequest) -> Result<FillOrderResponse> {");
  const end=text.indexOf("fn expire_due_orders_in_db(",begin);
  if(begin<0||end<0)throw Error("P2P_RUST_NATIVE_FILL_METHOD_DRIFT");
  let part=text.slice(begin,end);
  if(part.includes(STOCK_GUARD)){
   if(part.split(STOCK_GUARD).length!==2)throw Error("P2P_RUST_STOCK_GUARD_DUPLICATE");
   if(remove)part=part.replace(STOCK_GUARD,"");
  }else if(!remove){
   if(part.split(stockAnchor).length!==2)throw Error("P2P_RUST_STOCK_FILL_ANCHOR_DRIFT");
   part=part.replace(stockAnchor,stockAnchor.replace(
    '    if let Some((station_id, type_id))',
    STOCK_GUARD+'    if let Some((station_id, type_id))'));
  }
  text=text.slice(0,begin)+part+text.slice(end);
  if(text.includes(INCLUDE)){
   if(text.split(INCLUDE).length!==2)throw Error("P2P_RUST_EXTENSION_DUPLICATE");
   if(remove)text=text.replace(INCLUDE,"");
  }else if(!remove)text+=INCLUDE;
 }else throw Error("P2P_RUST_PATCH_UNKNOWN_FILE");
 return eol==="\r\n"?text.replace(/\n/g,"\r\n"):text;
}
function run({codePath,remove=false,dryRun=false,check=false}={}){
 if(!codePath||typeof codePath!=="string")throw Error("P2P_RUST_CODE_PATH_REQUIRED");
 const code=path.resolve(codePath);
 if(!fs.existsSync(path.join(code,"compose.yaml")))throw Error("P2P_RUST_NOT_EVEJS_CODE_ROOT");
 const sha=execFileSync("git",["-C",path.dirname(code),"rev-parse","HEAD"],{encoding:"utf8"}).trim();
 if(sha!==PIN)throw Error("P2P_RUST_UNPINNED_CHECKOUT");
 const extensionSource=fs.readFileSync(path.resolve(__dirname,"..","rust","coop_p2p_market_claim.rs"),"utf8");
 const changes=[];
 for(const [relative,kind] of [[RPC,"rpc"],[STATE,"state"]]){
  const full=path.join(code,relative),old=fs.readFileSync(full,"utf8");
  changes.push({full,relative,old,updated:check?old:patch(old,kind,remove)});
 }
 const full=path.join(code,EXT),old=fs.existsSync(full)?fs.readFileSync(full,"utf8"):null;
 if(old!==null&&old!==extensionSource)throw Error("P2P_RUST_EXTENSION_DRIFT");
 changes.push({full,relative:EXT,old,updated:check?old:remove?null:extensionSource});
 if(check){
  const state=changes.find(x=>x.relative===STATE).old,rpc=changes.find(x=>x.relative===RPC).old;
  if(!state.includes(INCLUDE)||!state.includes(STOCK_GUARD)||
     !rpc.includes(TYPES)||!rpc.includes(ARMS)||old!==extensionSource)
   throw Error("P2P_RUST_NOT_INSTALLED");
 }
 if(!check&&!dryRun){
  const done=[];
  try{
   for(const x of changes){
    if(x.updated===null)fs.unlinkSync(x.full);else fs.writeFileSync(x.full,x.updated);
    done.push(x);
   }
  }catch(e){
   for(const x of done.reverse())try{
    if(x.old===null)fs.unlinkSync(x.full);else fs.writeFileSync(x.full,x.old);
   }catch{}
   throw e;
  }
 }
 return {status:check?"CHECKED":dryRun?"DRY_RUN_OK":remove?"REMOVED":"INSTALLED",
  changes:changes.map(x=>({file:x.relative,changed:x.old!==x.updated}))};
}
if(require.main===module){
 try{
  const args=process.argv.slice(2),i=args.indexOf("--code-path");
  if(i<0||!args[i+1])throw Error("Usage: --code-path <pinned disposable EveJS/Code> [--dry-run|--check|--remove]");
  console.log(JSON.stringify(run({codePath:args[i+1],check:args.includes("--check"),
   dryRun:args.includes("--dry-run"),remove:args.includes("--remove")}),null,2));
 }catch(e){console.error("[P2P RUST]",e.message);process.exitCode=1}
}
module.exports={patch,run,PIN,STATE,RPC,EXT,TYPES,ARMS,INCLUDE,STOCK_GUARD};
