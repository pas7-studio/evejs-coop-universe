"use strict";
// COOP-035 manual Rust overlay extends COOP-034. Pinned, reversible,
// no live startup/daemon mutation. Run ONLY after COOP-034 overlay.
const fs=require("node:fs"),path=require("node:path");
const {execFileSync}=require("node:child_process");
const PIN="c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f";
const RPC="externalservices/market-server/src/rpc.rs";
const STATE="externalservices/market-server/src/state.rs";
const EXT="externalservices/market-server/src/coop_npc_market_settlement.rs";
const TYPES=String.raw`// COOP-035 RPC TYPES BEGIN
#[derive(Debug,Deserialize)]
struct CoopNpcBuyClaimParams{
    operation_id:String,
    #[serde(with="string_i64")]
    order_id:i64,
    #[serde(with="string_i64")]
    buyer_id:i64,
}
#[derive(Debug,Deserialize)]
struct CoopNpcBuyQueryParams{ operation_id:String }
#[derive(Debug,Deserialize)]
struct CoopNpcBuyFinishParams{
    operation_id:String,
    #[serde(with="string_i64")]
    order_id:i64,
    #[serde(with="string_i64")]
    buyer_id:i64,
    #[serde(with="string_i64")]
    fill_id:i64,
}
// COOP-035 RPC TYPES END
`;
const ARMS=String.raw`        // COOP-035 RPC ARMS BEGIN
        "ClaimNpcSellOrder" => {
            let p:CoopNpcBuyClaimParams=serde_json::from_value(params)?;
            Ok(runtime.coop_npc_claim_sell(p.operation_id,p.order_id,p.buyer_id).await?)
        }
        "GetNpcSellClaim" => {
            let p:CoopNpcBuyQueryParams=serde_json::from_value(params)?;
            Ok(runtime.coop_npc_get_claim(p.operation_id).await?)
        }
        "FinalizeNpcSellOrder" => {
            let p:CoopNpcBuyFinishParams=serde_json::from_value(params)?;
            Ok(runtime.coop_npc_finalize_sell(p.operation_id,p.order_id,p.buyer_id,p.fill_id).await?)
        }
        // COOP-035 RPC ARMS END
`;
const INCLUDE=String.raw`
// COOP-035 SETTLEMENT EXTENSION BEGIN
include!("coop_npc_market_settlement.rs");
// COOP-035 SETTLEMENT EXTENSION END
`;
const FILL_GUARD=String.raw`    // COOP-035 STOCK FILL GUARD BEGIN
    let coop_source = transaction.query_row(
        "SELECT source FROM market_orders WHERE order_id=?1",
        params![request.order_id],
        |row| row.get::<_,String>(0)
    ).optional()?;
    if coop_source.as_deref()==Some("coop-npc") {
        bail!("COOP_NPC_CORPORATE_ORDER_REQUIRES_CLAIM_FINALIZE");
    }
    // COOP-035 STOCK FILL GUARD END
`;
const MODIFY_GUARD=String.raw`    // COOP-035 STOCK MODIFY GUARD BEGIN
    let coop_source = transaction.query_row(
       "SELECT source FROM market_orders WHERE order_id=?1",
       params![request.order_id],
       |row| row.get::<_,String>(0)
    ).optional()?;
    if coop_source.as_deref()==Some("coop-npc") {
       bail!("COOP_NPC_CORPORATE_ORDER_MODIFY_FORBIDDEN");
    }
    // COOP-035 STOCK MODIFY GUARD END
`;
const CANCEL_GUARD=String.raw`    // COOP-035 STOCK CANCEL GUARD BEGIN
    let coop_source = transaction.query_row(
       "SELECT source FROM market_orders WHERE order_id=?1",
       params![order_id],
       |row| row.get::<_,String>(0)
    ).optional()?;
    if coop_source.as_deref()==Some("coop-npc") {
       bail!("COOP_NPC_CORPORATE_ORDER_CANCEL_REQUIRES_RECONCILIATION");
    }
    // COOP-035 STOCK CANCEL GUARD END
`;
const MODIFY_ANCHOR='    let scope = transaction\n        .query_row(\n            "SELECT region_id, solar_system_id, station_id, type_id, bid, vol_remaining, state';
const CANCEL_ANCHOR='    let scope = transaction\n        .query_row(\n            "SELECT state FROM market_orders WHERE order_id = ?1",';
const FILL_ANCHOR='    let scope = transaction\n        .query_row(\n            "SELECT owner_id, is_corp, region_id, solar_system_id, station_id, type_id, bid, price,';
function once(s,anchor,add){
 if(s.split(anchor).length!==2)throw Error("COOP035_UPSTREAM_ANCHOR_DRIFT");
 return s.replace(anchor,add+anchor);
}
function patch(src,which,remove=false){
 const crlf=src.includes("\r\n");
 let s=src.replace(/\r\n/g,"\n");
 if(which==="rpc"){
   if(remove){if(!s.includes(TYPES)||!s.includes(ARMS))throw Error("COOP035_RPC_MISSING");
    s=s.replace(TYPES,"").replace(ARMS,"");}
   else{
    if(!s.includes("// COOP-034 RPC ARMS BEGIN"))throw Error("COOP034_RUST_DEPENDENCY_MISSING");
    if(s.includes("// COOP-035 RPC TYPES BEGIN"))throw Error("COOP035_RPC_ALREADY_PATCHED");
    s=once(s,"#[derive(Debug, Deserialize)]\nstruct RpcRequest",TYPES);
    s=once(s,'        "ModifyOrder" =>',ARMS);
   }
 }else if(which==="state"){
   if(remove){if(!s.includes(FILL_GUARD)||!s.includes(INCLUDE)||!s.includes(MODIFY_GUARD)||!s.includes(CANCEL_GUARD))throw Error("COOP035_STATE_MISSING");
    s=s.replace(FILL_GUARD,"").replace(MODIFY_GUARD,"").replace(CANCEL_GUARD,"").replace(INCLUDE,"");}
   else{
    if(!s.includes('// COOP-034 RUST EXTENSION BEGIN'))throw Error("COOP034_RUST_DEPENDENCY_MISSING");
    if(s.includes("// COOP-035 SETTLEMENT EXTENSION BEGIN"))throw Error("COOP035_STATE_ALREADY_PATCHED");
    s=once(s,FILL_ANCHOR,FILL_GUARD);
    s=once(s,MODIFY_ANCHOR,MODIFY_GUARD);
    s=once(s,CANCEL_ANCHOR,CANCEL_GUARD);
    s+=INCLUDE;
   }
 }else throw Error("COOP035_UNKNOWN_FILE");
 return crlf?s.replace(/\n/g,"\r\n"):s;
}
function run({codePath,remove=false,dryRun=false,check=false}={}){
 const code=path.resolve(codePath||"");
 if(!fs.existsSync(path.join(code,"compose.yaml")))throw Error("COOP035_INVALID_CODE_ROOT");
 const sha=execFileSync("git",["-C",path.dirname(code),"rev-parse","HEAD"],{encoding:"utf8"}).trim();
 if(sha!==PIN)throw Error("COOP035_PIN_MISMATCH:"+sha);
 const plan=[];
 for(const [name,which] of [[RPC,"rpc"],[STATE,"state"]]){
  const file=path.join(code,name),before=fs.readFileSync(file,"utf8");
  const after=check?before:patch(before,which,remove);
  plan.push({file,name,before,after,state:before.includes("COOP-035")?"PATCHED":"PRISTINE"});
 }
 const extension=path.join(code,EXT);
 const expected=fs.readFileSync(path.join(__dirname,"..","rust","coop_npc_market_settlement.rs"),"utf8");
 const old=fs.existsSync(extension)?fs.readFileSync(extension,"utf8"):null;
 if(old!==null&&old!==expected)throw Error("COOP035_RUST_EXTENSION_DRIFT");
 plan.push({file:extension,name:EXT,before:old,after:check?old:remove?null:expected,
  state:old===null?"MISSING":"CURRENT"});
 if(!check&&!dryRun){
  const done=[];
  try{for(const f of plan){if(f.after===null)fs.unlinkSync(f.file);else fs.writeFileSync(f.file,f.after);done.push(f)}}
  catch(e){for(const f of done.reverse()){
   try{if(f.before===null)fs.unlinkSync(f.file);else fs.writeFileSync(f.file,f.before)}catch(_){}}
   throw e}
 }
 return {status:check?"CHECKED":dryRun?"DRY_RUN_OK":remove?"REMOVED":"INSTALLED",
  files:plan.map(x=>({path:x.name,state:x.state,changed:x.before!==x.after}))};
}
if(require.main===module){
 try{const a=process.argv.slice(2),i=a.indexOf("--code-path");
  if(i<0||!a[i+1])throw Error("Usage: --code-path <disposable EveJS/Code> [--dry-run|--check|--remove]");
  console.log(JSON.stringify(run({codePath:a[i+1],remove:a.includes("--remove"),
   dryRun:a.includes("--dry-run"),check:a.includes("--check")}),null,2));
 }catch(e){console.error("[COOP-035]",e.message);process.exitCode=1}
}
module.exports={patch,run,RPC,STATE,EXT,PIN};
