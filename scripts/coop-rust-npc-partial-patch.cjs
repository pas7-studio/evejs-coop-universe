"use strict";
// COOP-047: reversible pinned extension after COOP-034/035.
// No writes to user's game or Docker unless explicitly invoked with --code-path.
const fs=require("node:fs"),path=require("node:path");
const {execFileSync}=require("node:child_process");
const PIN="c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f";
const RPC="externalservices/market-server/src/rpc.rs";
const STATE="externalservices/market-server/src/state.rs";
const EXT="externalservices/market-server/src/coop_npc_market_partial.rs";
const TYPES=String.raw`// COOP-047 PARTIAL RPC TYPES BEGIN
#[derive(Debug,Deserialize)]
struct CoopNpcPartialClaimParams{
    operation_id:String,claim_key:String,
    #[serde(with="string_i64")]
    order_id:i64,
    #[serde(with="string_i64")]
    buyer_id:i64,
    #[serde(with="string_i64")]
    quantity:i64,
}
#[derive(Debug,Deserialize)]
struct CoopNpcPartialQueryParams{operation_id:String,claim_key:String}
#[derive(Debug,Deserialize)]
struct CoopNpcPartialFinishParams{
    operation_id:String,claim_key:String,
    #[serde(with="string_i64")]
    order_id:i64,
    #[serde(with="string_i64")]
    buyer_id:i64,
    #[serde(with="string_i64")]
    fill_id:i64,
    #[serde(with="string_i64")]
    quantity:i64,
}
// COOP-047 PARTIAL RPC TYPES END
`;
const ARMS=String.raw`        // COOP-047 PARTIAL RPC ARMS BEGIN
        "ClaimNpcPartialSell" => {
            let p:CoopNpcPartialClaimParams=serde_json::from_value(params)?;
            Ok(runtime.coop_npc_claim_partial(p.operation_id,p.claim_key,
              p.order_id,p.buyer_id,p.quantity).await?)
        }
        "GetNpcPartialClaim" => {
            let p:CoopNpcPartialQueryParams=serde_json::from_value(params)?;
            Ok(runtime.coop_npc_get_partial(p.operation_id,p.claim_key).await?)
        }
        "FinalizeNpcPartialSell" => {
            let p:CoopNpcPartialFinishParams=serde_json::from_value(params)?;
            Ok(runtime.coop_npc_finalize_partial(p.operation_id,p.claim_key,
              p.order_id,p.buyer_id,p.fill_id,p.quantity).await?)
        }
        // COOP-047 PARTIAL RPC ARMS END
`;
const INCLUDE=String.raw`
// COOP-047 PARTIAL SETTLEMENT BEGIN
include!("coop_npc_market_partial.rs");
// COOP-047 PARTIAL SETTLEMENT END
`;
function once(s,a,b){if(s.split(a).length!==2)throw Error("COOP047_NATIVE_ANCHOR_DRIFT");return s.replace(a,b+a);}
function patch(source,which,remove=false){
 const crlf=source.includes("\r\n");let s=source.replace(/\r\n/g,"\n");
 if(which==="rpc"){
  if(remove){
   if(!s.includes(TYPES)||!s.includes(ARMS))throw Error("COOP047_RPC_NOT_INSTALLED");
   s=s.replace(TYPES,"").replace(ARMS,"");
  }else{
   if(!s.includes("// COOP-035 RPC ARMS BEGIN"))throw Error("COOP047_REQUIRES_COOP035_RPC");
   if(s.includes("// COOP-047 PARTIAL RPC TYPES BEGIN"))throw Error("COOP047_RPC_ALREADY_PATCHED");
   s=once(s,"#[derive(Debug, Deserialize)]\nstruct RpcRequest",TYPES);
   s=once(s,'        "ModifyOrder" =>',ARMS);
  }
 }else if(which==="state"){
  if(remove){
   if(!s.includes(INCLUDE))throw Error("COOP047_STATE_NOT_INSTALLED");
   s=s.replace(INCLUDE,"");
  }else{
   if(!s.includes("// COOP-035 SETTLEMENT EXTENSION BEGIN"))throw Error("COOP047_REQUIRES_COOP035_STATE");
   if(s.includes("// COOP-047 PARTIAL SETTLEMENT BEGIN"))throw Error("COOP047_STATE_ALREADY_PATCHED");
   s+=INCLUDE;
  }
 }else throw Error("COOP047_UNKNOWN_SOURCE_FILE");
 return crlf?s.replace(/\n/g,"\r\n"):s;
}
function run({codePath,remove=false,dryRun=false,check=false}={}){
 const root=path.resolve(codePath||"");
 if(!fs.existsSync(path.join(root,"compose.yaml")))throw Error("COOP047_INVALID_CODE_ROOT");
 const sha=execFileSync("git",["-C",path.dirname(root),"rev-parse","HEAD"],{encoding:"utf8"}).trim();
 if(sha!==PIN)throw Error("COOP047_PIN_MISMATCH:"+sha);
 const plan=[];
 for(const [name,which] of [[RPC,"rpc"],[STATE,"state"]]){
  const file=path.join(root,name),old=fs.readFileSync(file,"utf8"),
   next=check?old:patch(old,which,remove);
  plan.push({file,name,old,next});
 }
 const file=path.join(root,EXT),
  expected=fs.readFileSync(path.join(__dirname,"..","rust","coop_npc_market_partial.rs"),"utf8");
 const old=fs.existsSync(file)?fs.readFileSync(file,"utf8"):null;
 if(old!==null&&old!==expected)throw Error("COOP047_RUST_EXTENSION_DRIFT");
 plan.push({file,name:EXT,old,next:check?old:remove?null:expected});
 if(!check&&!dryRun){
  const done=[];
  try{for(const x of plan){
   if(x.next===null)fs.unlinkSync(x.file);else fs.writeFileSync(x.file,x.next);done.push(x);
  }}catch(error){for(const x of done.reverse())try{
    if(x.old===null)fs.unlinkSync(x.file);else fs.writeFileSync(x.file,x.old);
   }catch(_e){}throw error;}
 }
 return {status:check?"CHECKED":dryRun?"DRY_RUN_OK":remove?"REMOVED":"INSTALLED",
  files:plan.map(x=>({path:x.name,changed:x.old!==x.next}))};
}
if(require.main===module){
 try{const args=process.argv.slice(2),i=args.indexOf("--code-path");
  if(i<0||!args[i+1])throw Error("Usage: --code-path <disposable pinned EveJS/Code> [--dry-run|--check|--remove]");
  console.log(JSON.stringify(run({codePath:args[i+1],
   remove:args.includes("--remove"),dryRun:args.includes("--dry-run"),
   check:args.includes("--check")}),null,2));
 }catch(error){console.error("[COOP-047]",error.message);process.exitCode=1;}
}
module.exports={patch,run,RPC,STATE,EXT,PIN,TYPES,ARMS,INCLUDE};
