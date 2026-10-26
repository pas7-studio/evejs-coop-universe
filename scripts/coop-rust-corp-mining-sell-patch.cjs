"use strict";
// CH24+31 E2B2: isolated pinned, reversible Rust market-server overlay.
// No parallel daemon and no new market database. NO automatic deployment.
const fs=require("node:fs"),path=require("node:path");
const {execFileSync}=require("node:child_process");
const PIN="c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f";
const STATE="externalservices/market-server/src/state.rs";
const RPC="externalservices/market-server/src/rpc.rs";
const EXT="externalservices/market-server/src/coop_corp_mining_sell.rs";
const TYPES=[
"// CH24+31 CORPORATE RUST SELL TYPES BEGIN",
"#[derive(Debug,Deserialize)]",
"struct CoopCorpPrepareParams {",
"    access_token:String,",
"    operation_id:String,",
"    shift_id:String,",
"    cargo_id:i64,",
"    source_item_id:i64,",
"    owner_id:i64,",
"    station_id:i64,",
"    type_id:i64,",
"    quantity:i64,",
"    price_cents:i64,",
"}",
"#[derive(Debug,Deserialize)]",
"struct CoopCorpQueryParams {",
"    access_token:String,",
"    operation_id:String,",
"}",
"// CH24+31 CORPORATE RUST SELL TYPES END",
""].join("\n");
const ARMS=[
'        // CH24+31 CORPORATE RUST SELL ARMS BEGIN',
'        "PrepareCorpSell" => {',
'            let p:CoopCorpPrepareParams=serde_json::from_value(params)?;',
'            Ok(runtime.coop_corp_sell_prepare(p.access_token,p.operation_id,p.shift_id,',
'                p.cargo_id,p.source_item_id,p.owner_id,p.station_id,',
'                p.type_id,p.quantity,p.price_cents).await?)',
'        }',
'        "GetCorpSell" => {',
'            let p:CoopCorpQueryParams=serde_json::from_value(params)?;',
'            Ok(runtime.coop_corp_sell_get(p.access_token,p.operation_id).await?)',
'        }',
'        "VerifyCorpSellEscrow" => {',
'            let p:CoopCorpQueryParams=serde_json::from_value(params)?;',
'            Ok(runtime.coop_corp_sell_verify(p.access_token,p.operation_id).await?)',
'        }',
'        "PublishCorpSell" => {',
'            let p:CoopCorpQueryParams=serde_json::from_value(params)?;',
'            Ok(runtime.coop_corp_sell_publish(p.access_token,p.operation_id).await?)',
'        }',
'        // CH24+31 CORPORATE RUST SELL ARMS END',
''].join("\n");
const CLAIM_TYPES=[
"// CH24+31 CORP FILL CLAIM TYPES BEGIN",
"#[derive(Debug,Deserialize)]",
"struct CoopCorpFillClaimParams {",
"    access_token:String,",
"    #[serde(deserialize_with=\"string_i64::deserialize\")]",
"    order_id:i64,",
"    cycle:i64,",
"    buyer_id:i64,",
"    volume_before:i64,",
"    filled_quantity:i64,",
"    price_cents:i64,",
"}",
"#[derive(Debug,Deserialize)]",
"struct CoopCorpFillQueryParams {",
"    access_token:String,",
"    #[serde(deserialize_with=\"string_i64::deserialize\")]",
"    order_id:i64,",
"    cycle:i64,",
"}",
"// CH24+31 CORP FILL CLAIM TYPES END",
""].join("\n");
const CLAIM_ARMS=[
'        // CH24+31 CORP FILL CLAIM ARMS BEGIN',
'        "ClaimCorpFill" => {',
'            let p:CoopCorpFillClaimParams=serde_json::from_value(params)?;',
'            Ok(runtime.coop_corp_fill_claim(p.access_token,p.order_id,p.cycle,',
'                p.buyer_id,p.volume_before,p.filled_quantity,p.price_cents).await?)',
'        }',
'        "GetCorpFillClaim" => {',
'            let p:CoopCorpFillQueryParams=serde_json::from_value(params)?;',
'            Ok(runtime.coop_corp_fill_get(p.access_token,p.order_id,p.cycle).await?)',
'        }',
'        "FinalizeCorpFill" => {',
'            let p:CoopCorpFillQueryParams=serde_json::from_value(params)?;',
'            Ok(runtime.coop_corp_fill_finalize(p.access_token,p.order_id,p.cycle).await?)',
'        }',
'        "ReleaseCorpFill" => {',
'            let p:CoopCorpFillQueryParams=serde_json::from_value(params)?;',
'            Ok(runtime.coop_corp_fill_release(p.access_token,p.order_id,p.cycle).await?)',
'        }',
'        // CH24+31 CORP FILL CLAIM ARMS END',
''].join("\n");
const GUARD=[
'    // CH24+31 CORPORATE SELL STOCK PLACEORDER GUARD BEGIN',
'    if source == "coop-corporation" {',
'        bail!("CORP_SELL_REQUIRES_PRIVATE_PREPARE");',
'    }',
'    // CH24+31 CORPORATE SELL STOCK PLACEORDER GUARD END',
''].join("\n");
const STANDARD_ORDER_GUARDS={
 fill:[
  '    // CH24+31 CORPORATE ORDER STOCK FILL GUARD BEGIN',
  '    let corporate_order:Option<i64>=transaction.query_row(',
  '      "SELECT is_corp FROM market_orders WHERE order_id=?1',
  '       AND source=\'coop-corporation\'",',
  '      params![request.order_id],|r|r.get(0)).optional()?;',
  '    if corporate_order.is_some(){bail!("CORP_SELL_STOCK_FILL_DENIED");}',
  '    // CH24+31 CORPORATE ORDER STOCK FILL GUARD END',
  ''].join("\n"),
 cancel:[
  '    // CH24+31 CORPORATE ORDER STOCK CANCEL GUARD BEGIN',
  '    let corporate_order:Option<i64>=transaction.query_row(',
  '      "SELECT is_corp FROM market_orders WHERE order_id=?1',
  '       AND source=\'coop-corporation\'",',
  '      params![order_id],|r|r.get(0)).optional()?;',
  '    if corporate_order.is_some(){bail!("CORP_SELL_STOCK_CANCEL_DENIED");}',
  '    // CH24+31 CORPORATE ORDER STOCK CANCEL GUARD END',
  ''].join("\n"),
 modify:[
  '    // CH24+31 CORPORATE ORDER STOCK MODIFY GUARD BEGIN',
  '    let corporate_order:Option<i64>=transaction.query_row(',
  '      "SELECT is_corp FROM market_orders WHERE order_id=?1',
  '       AND source=\'coop-corporation\'",',
  '      params![request.order_id],|r|r.get(0)).optional()?;',
  '    if corporate_order.is_some(){bail!("CORP_SELL_STOCK_MODIFY_DENIED");}',
  '    // CH24+31 CORPORATE ORDER STOCK MODIFY GUARD END',
  ''].join("\n")
};
const INCLUDE=[
'',
'// CH24+31 CORPORATE RUST SELL EXTENSION BEGIN',
'include!("coop_corp_mining_sell.rs");',
'// CH24+31 CORPORATE RUST SELL EXTENSION END',
''].join("\n");
const unique=(src,part)=>src.split(part).length-1;
function patch(source,which,remove=false){
 if(typeof source!=="string")throw Error("CORP_RUST_SOURCE_REQUIRED");
 const eol=source.includes("\r\n")?"\r\n":"\n";
 let text=source.replace(/\r\n/g,"\n");
 const put=(part,anchor)=>{
  if(remove){
   if(unique(text,part)!==1)throw Error("CORP_RUST_REMOVE_DRIFT");
   text=text.replace(part,"");
  }else if(unique(text,part)===1)return;
  else{
   if(unique(text,part)!==0||unique(text,anchor)!==1)
    throw Error("CORP_RUST_PINNED_ANCHOR_DRIFT");
   text=text.replace(anchor,part+anchor);
  }
 };
 if(which==="rpc"){
  if(remove){
   put(CLAIM_TYPES,"#[derive(Debug, Deserialize)]\nstruct RpcRequest");
   put(CLAIM_ARMS,'        "ModifyOrder" =>');
   put(TYPES,"#[derive(Debug, Deserialize)]\nstruct RpcRequest");
   put(ARMS,'        "ModifyOrder" =>');
  }else{
   put(TYPES,"#[derive(Debug, Deserialize)]\nstruct RpcRequest");
   put(ARMS,'        "ModifyOrder" =>');
   put(CLAIM_TYPES,"#[derive(Debug, Deserialize)]\nstruct RpcRequest");
   put(CLAIM_ARMS,'        "ModifyOrder" =>');
  }
 }else if(which==="state"){
  put(GUARD,"    let wallet_division = request.wallet_division.unwrap_or(1000);");
  for(const [kind,anchor,block] of [
   ["fill","fn fill_order_in_db(database_path: &Path, request: FillOrderRequest) -> Result<FillOrderResponse> {",STANDARD_ORDER_GUARDS.fill],
   ["cancel","fn cancel_order_in_db(","",STANDARD_ORDER_GUARDS.cancel],
   ["modify","fn modify_order_in_db(","",STANDARD_ORDER_GUARDS.modify]
  ]){
   if(remove){
    if(unique(text,block)!==1)throw Error("CORP_RUST_STOCK_GUARD_REMOVE_DRIFT:"+kind);
    text=text.replace(block,"");
   }else if(unique(text,block)===0){
    const start=text.indexOf(anchor);
    if(start<0||text.indexOf(anchor,start+anchor.length)>=0)
     throw Error("CORP_RUST_STOCK_GUARD_ANCHOR_DRIFT:"+kind);
    const begin=text.indexOf("    let transaction = connection.transaction()?;\\n".replace("\\n","\n"),start);
    if(begin<0||begin-start>1800)throw Error("CORP_RUST_TRANSACTION_ANCHOR_DRIFT:"+kind);
    const where=begin+"    let transaction = connection.transaction()?;".length+"\n".length;
    text=text.slice(0,where)+block+text.slice(where);
   }else if(unique(text,block)!==1)throw Error("CORP_RUST_STOCK_GUARD_DUPLICATE:"+kind);
  }
  if(remove){
   if(unique(text,INCLUDE)!==1)throw Error("CORP_RUST_INCLUDE_DRIFT");
   text=text.replace(INCLUDE,"");
  }else if(unique(text,INCLUDE)===0)text+=INCLUDE;
  else if(unique(text,INCLUDE)!==1)throw Error("CORP_RUST_INCLUDE_DUPLICATE");
 }else throw Error("CORP_RUST_PATCH_TARGET_UNKNOWN");
 return eol==="\r\n"?text.replace(/\n/g,"\r\n"):text;
}
function run({codePath,dryRun=false,check=false,remove=false}={}){
 const code=path.resolve(codePath||"");
 if(!fs.existsSync(path.join(code,"compose.yaml")))
  throw Error("INVALID_PINNED_EVEJS_CODE_ROOT");
 const rev=execFileSync("git",["-C",path.dirname(code),"rev-parse","HEAD"],
  {encoding:"utf8"}).trim();
 if(rev!==PIN)throw Error("REFUSE_MISMATCHED_EVEJS_PIN:"+rev);
 const expected=fs.readFileSync(path.join(__dirname,"..","rust","coop_corp_mining_sell.rs"),"utf8");
 const files=[];
 for(const [name,kind] of [[STATE,"state"],[RPC,"rpc"]]){
  const file=path.join(code,name),before=fs.readFileSync(file,"utf8"),
   installed=before.includes(kind==="state"?
    "CH24+31 CORPORATE RUST SELL EXTENSION BEGIN":
    "CH24+31 CORPORATE RUST SELL ARMS BEGIN");
  if(check&&installed!==!remove)
   throw Error("CORP_RUST_INSTALLED_STATE_MISMATCH:"+name);
  files.push({file,name,before,after:check?before:patch(before,kind,remove)});
 }
 const file=path.join(code,EXT),before=fs.existsSync(file)?fs.readFileSync(file,"utf8"):null;
 if(before!==null&&before!==expected)throw Error("CORP_RUST_EXTENSION_CONTENT_DRIFT");
 if(check&&Boolean(before)!==!remove)throw Error("CORP_RUST_EXTENSION_INSTALL_DRIFT");
 files.push({file,name:EXT,before,after:check?before:remove?null:expected});
 if(!check&&!dryRun){
  const written=[];
  try{
   for(const f of files){
    if(f.after===null)fs.unlinkSync(f.file);
    else fs.writeFileSync(f.file,f.after);
    written.push(f);
   }
  }catch(err){
   for(const f of written.reverse()){
    try{if(f.before===null)fs.unlinkSync(f.file);
     else fs.writeFileSync(f.file,f.before)}catch{}
   }
   throw err;
  }
 }
 return {status:check?"CHECKED":dryRun?"DRY_RUN_OK":remove?"REMOVED":"INSTALLED",
  files:files.map(f=>({path:f.name,changed:f.before!==f.after}))};
}
if(require.main===module){
 try{
  const args=process.argv.slice(2),p=args.indexOf("--code-path");
  if(p<0||!args[p+1])throw Error("Usage: --code-path <exact pinned Code> [--dry-run|--check|--remove]");
  console.log(JSON.stringify(run({codePath:args[p+1],dryRun:args.includes("--dry-run"),
   check:args.includes("--check"),remove:args.includes("--remove")}),null,2));
 }catch(e){console.error("E2B2 Rust blocked:",e.message);process.exitCode=1;}
}
module.exports={patch,run,PIN,STATE,RPC,EXT,TYPES,ARMS,CLAIM_TYPES,CLAIM_ARMS,GUARD,STANDARD_ORDER_GUARDS,INCLUDE};
