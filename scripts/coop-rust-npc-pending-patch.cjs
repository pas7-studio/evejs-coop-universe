"use strict";
// COOP-034 Rust-only overlay. Reversible and independent of Node game overlay.
// Does not install unless explicitly run. Refuses non-pinned upstream.
const fs=require("node:fs"),path=require("node:path");
const {execFileSync}=require("node:child_process");
const PIN="c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f";
const STATE="externalservices/market-server/src/state.rs";
const RPC="externalservices/market-server/src/rpc.rs";
const EXT="externalservices/market-server/src/coop_npc_market_pending.rs";
const rpcModels=String.raw`// COOP-034 RPC TYPES BEGIN
#[derive(Debug,Deserialize)]
struct CoopNpcReserveParams {
    operation_id:String,
    #[serde(with="string_i64")]
    source_item_id:i64,
    owner_id:u64,
    is_corp:bool,
    station_id:u64,
    type_id:u32,
    quantity:u64,
    price:f64,
    bid:bool,
}
#[derive(Debug,Deserialize)]
struct CoopNpcQueryParams { operation_id:String }
#[derive(Debug,Deserialize)]
struct CoopNpcActivateParams {
    operation_id:String,
    #[serde(with="string_i64")]
    order_id:i64,
    #[serde(with="string_i64")]
    source_item_id:i64,
}
// COOP-034 RPC TYPES END
`;
const rpcArms=String.raw`        // COOP-034 RPC ARMS BEGIN
        "ReserveNpcSellOrder" => {
            let p:CoopNpcReserveParams=serde_json::from_value(params)?;
            let request=market_common::PlaceOrderRequest {
                owner_id:p.owner_id,is_corp:p.is_corp,wallet_division:Some(1000),
                station_id:p.station_id,type_id:p.type_id,price:p.price,quantity:p.quantity,
                min_volume:Some(1),duration_days:Some(90),range_value:Some(32767),
                bid:p.bid,source:Some("coop-npc".to_string())
            };
            Ok(runtime.coop_npc_reserve(request,p.operation_id,p.source_item_id).await?)
        }
        "GetNpcSellOrder" => {
            let p:CoopNpcQueryParams=serde_json::from_value(params)?;
            Ok(runtime.coop_npc_get(p.operation_id).await?)
        }
        "ActivateNpcSellOrder" => {
            let p:CoopNpcActivateParams=serde_json::from_value(params)?;
            Ok(runtime.coop_npc_activate(p.operation_id,p.order_id,p.source_item_id).await?)
        }
        // COOP-034 RPC ARMS END
`;
const stateGuard=String.raw`    // COOP-034 STOCK RPC SOURCE GUARD BEGIN
    if source.starts_with("coop-npc") {
        bail!("NPC sell orders must use pending escrow RPC");
    }
    // COOP-034 STOCK RPC SOURCE GUARD END
`;
const stateInclude=String.raw`
// COOP-034 RUST EXTENSION BEGIN
include!("coop_npc_market_pending.rs");
// COOP-034 RUST EXTENSION END
`;
function once(source,anchor,insert){
 if(source.split(anchor).length!==2)throw Error("RUST_SOURCE_ANCHOR_MISMATCH:"+anchor.slice(0,90));
 return source.replace(anchor,insert+anchor);
}
function patch(source,kind,remove=false){
 const eol=source.includes("\r\n")?"\r\n":"\n";
 let s=source.replace(/\r\n/g,"\n");
 if(kind==="rpc"){
  if(remove){if(!s.includes(rpcModels)||!s.includes(rpcArms))throw Error("RUST_RPC_OVERLAY_MISSING");
   s=s.replace(rpcModels,"").replace(rpcArms,"");}
  else{if(s.includes("// COOP-034 RPC TYPES BEGIN"))throw Error("RUST_RPC_ALREADY_PATCHED");
   s=once(s,"#[derive(Debug, Deserialize)]\nstruct RpcRequest",rpcModels);
   s=once(s,'        "ModifyOrder" =>',rpcArms);}
 }else if(kind==="state"){
  if(remove){if(!s.includes(stateGuard)||!s.includes(stateInclude))throw Error("RUST_STATE_OVERLAY_MISSING");
   s=s.replace(stateGuard,"").replace(stateInclude,"");}
  else{if(s.includes("// COOP-034 RUST EXTENSION BEGIN"))throw Error("RUST_STATE_ALREADY_PATCHED");
   s=once(s,"    let wallet_division = request.wallet_division.unwrap_or(1000);",stateGuard);
   s+=stateInclude;}
 }else throw Error("UNKNOWN_RUST_TARGET");
 return eol==="\r\n"?s.replace(/\n/g,"\r\n"):s;
}
function run({codePath,remove=false,dryRun=false,check=false}={}){
 const code=path.resolve(codePath||"");
 if(!fs.existsSync(path.join(code,"compose.yaml")))throw Error("INVALID_PINNED_EVEJS_CODE_ROOT");
 const sha=execFileSync("git",["-C",path.dirname(code),"rev-parse","HEAD"],{encoding:"utf8"}).trim();
 if(sha!==PIN)throw Error("REFUSE_MISMATCHED_EVEJS_PIN:"+sha);
 const expected=fs.readFileSync(path.join(__dirname,"..","rust","coop_npc_market_pending.rs"),"utf8");
 const plan=[];
 for(const [name,kind] of [[STATE,"state"],[RPC,"rpc"]]){
  const file=path.join(code,name),before=fs.readFileSync(file,"utf8");
  const installed=before.includes("COOP-034 ");
  const after=check?before:patch(before,kind,remove);
  plan.push({file,name,before,after,state:installed?"PATCHED":"PRISTINE"});
 }
 const extension=path.join(code,EXT),previous=fs.existsSync(extension)?fs.readFileSync(extension,"utf8"):null;
 if(previous!==null&&previous!==expected)throw Error("RUST_EXTENSION_FILE_DRIFT");
 plan.push({file:extension,name:EXT,before:previous,after:check?previous:remove?null:expected,
  state:previous===null?"MISSING":"CURRENT"});
 if(!check&&!dryRun){
  const completed=[];
  try{for(const p of plan){if(p.after===null)fs.unlinkSync(p.file);else fs.writeFileSync(p.file,p.after);
   completed.push(p);}}
  catch(e){for(const p of completed.reverse()){
   try{if(p.before===null)fs.unlinkSync(p.file);else fs.writeFileSync(p.file,p.before)}catch(_){}
  }throw e}
 }
 return {status:check?"CHECKED":dryRun?"DRY_RUN_OK":remove?"REMOVED":"INSTALLED",
  files:plan.map(p=>({path:p.name,changed:p.before!==p.after,state:p.state}))};
}
if(require.main===module){
 try{const args=process.argv.slice(2),i=args.indexOf("--code-path");
  if(i<0||!args[i+1])throw Error("Usage: --code-path <pinned Code> [--dry-run|--check|--remove]");
  console.log(JSON.stringify(run({codePath:args[i+1],remove:args.includes("--remove"),
   dryRun:args.includes("--dry-run"),check:args.includes("--check")}),null,2));
 }catch(e){console.error("COOP-034 Rust overlay BLOCKED:",e.message);process.exitCode=1}
}
module.exports={patch,run,PIN,STATE,RPC,EXT};
