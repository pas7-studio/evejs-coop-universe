"use strict";
// COOP-048 pinned, reversible MANUAL Rust RPC overlay, never auto deploy.
const fs=require("node:fs"),path=require("node:path");
const {execFileSync}=require("node:child_process");
const PIN="c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f";
const RPC="externalservices/market-server/src/rpc.rs";
const STATE="externalservices/market-server/src/state.rs";
const EXT="externalservices/market-server/src/coop_npc_corp_buy_player.rs";
const TYPES=String.raw`// COOP-048 NPC CORP BUY RPC TYPES BEGIN
#[derive(Debug,Deserialize)]
struct CoopNpcCorpBuyClaimParams{
    claim_key:String,
    #[serde(with="string_i64")]
    order_id:i64,
    #[serde(with="string_i64")]
    buyer_corp_id:i64,
    #[serde(with="string_i64")]
    seller_id:i64,
    #[serde(with="string_i64")]
    quantity:i64,
}
#[derive(Debug,Deserialize)]
struct CoopNpcCorpBuyQueryParams{ claim_key:String }
#[derive(Debug,Deserialize)]
struct CoopNpcCorpBuyFinishParams{
    claim_key:String,
    #[serde(with="string_i64")]
    order_id:i64,
    #[serde(with="string_i64")]
    buyer_corp_id:i64,
    #[serde(with="string_i64")]
    fill_id:i64,
}
// COOP-048 NPC CORP BUY RPC TYPES END
`;
const ARMS=String.raw`        // COOP-048 NPC CORP BUY RPC ARMS BEGIN
        "ClaimNpcCorpPlayerSell" => {
            let p:CoopNpcCorpBuyClaimParams=serde_json::from_value(params)?;
            Ok(runtime.coop_npc_corp_buy_claim(p.claim_key,p.order_id,
              p.buyer_corp_id,p.seller_id,p.quantity).await?)
        }
        "GetNpcCorpPlayerClaim" => {
            let p:CoopNpcCorpBuyQueryParams=serde_json::from_value(params)?;
            Ok(runtime.coop_npc_corp_buy_inspect(p.claim_key).await?)
        }
        "FinalizeNpcCorpPlayerSell" => {
            let p:CoopNpcCorpBuyFinishParams=serde_json::from_value(params)?;
            Ok(runtime.coop_npc_corp_buy_finalize(p.claim_key,p.order_id,
              p.buyer_corp_id,p.fill_id).await?)
        }
        // COOP-048 NPC CORP BUY RPC ARMS END
`;
const INCLUDE=String.raw`
// COOP-048 NPC CORP BUY EXTENSION BEGIN
include!("coop_npc_corp_buy_player.rs");
// COOP-048 NPC CORP BUY EXTENSION END
`;
function once(text,anchor,addition){
 if(text.split(anchor).length!==2)throw Error("COOP048_UPSTREAM_RUST_ANCHOR_DRIFT");
 return text.replace(anchor,addition+anchor);
}
function patch(source,which,remove=false){
 const crlf=source.includes("\r\n");let result=source.replace(/\r\n/g,"\n");
 if(which==="rpc"){
  if(remove){
   if(!result.includes(TYPES)||!result.includes(ARMS))throw Error("COOP048_RUST_RPC_NOT_PATCHED");
   result=result.replace(TYPES,"").replace(ARMS,"");
  }else{
   if(!result.includes("// COOP-047 PARTIAL RPC ARMS BEGIN"))
    throw Error("COOP048_NEEDS_COOP047_RUST_RPC");
   if(result.includes("// COOP-048 NPC CORP BUY RPC TYPES BEGIN"))
    throw Error("COOP048_RPC_ALREADY_PATCHED");
   result=once(result,"#[derive(Debug, Deserialize)]\nstruct RpcRequest",TYPES);
   result=once(result,'        "ModifyOrder" =>',ARMS);
  }
 }else if(which==="state"){
  if(remove){
   if(!result.includes(INCLUDE))throw Error("COOP048_RUST_STATE_NOT_PATCHED");
   result=result.replace(INCLUDE,"");
  }else{
   if(!result.includes("// COOP-047 PARTIAL SETTLEMENT BEGIN"))
    throw Error("COOP048_NEEDS_COOP047_RUST_STATE");
   if(result.includes("// COOP-048 NPC CORP BUY EXTENSION BEGIN"))
    throw Error("COOP048_STATE_ALREADY_PATCHED");
   result+=INCLUDE;
  }
 }else throw Error("COOP048_UNKNOWN_RUST_SOURCE_FILE");
 return crlf?result.replace(/\n/g,"\r\n"):result;
}
function run({codePath,remove=false,check=false,dryRun=false}={}){
 const root=path.resolve(codePath||"");
 if(!fs.existsSync(path.join(root,"compose.yaml")))
   throw Error("COOP048_INVALID_DISPOSABLE_CODE_ROOT");
 const sha=execFileSync("git",["-C",path.dirname(root),"rev-parse","HEAD"],{encoding:"utf8"}).trim();
 if(sha!==PIN)throw Error("COOP048_UPSTREAM_PIN_MISMATCH:"+sha);
 const plan=[];
 for(const [name,which] of [[RPC,"rpc"],[STATE,"state"]]){
  const file=path.join(root,name),old=fs.readFileSync(file,"utf8"),
   next=check?old:patch(old,which,remove);
  plan.push({file,path:name,old,next});
 }
 const file=path.join(root,EXT),
  expected=fs.readFileSync(path.join(__dirname,"..","rust","coop_npc_corp_buy_player.rs"),"utf8");
 const old=fs.existsSync(file)?fs.readFileSync(file,"utf8"):null;
 if(old!==null&&old!==expected)throw Error("COOP048_RUST_EXTENSION_DRIFT");
 plan.push({file,path:EXT,old,next:check?old:remove?null:expected});
 if(!check&&!dryRun){
  const completed=[];
  try{
   for(const entry of plan){
    if(entry.next===null)fs.unlinkSync(entry.file);
    else fs.writeFileSync(entry.file,entry.next);
    completed.push(entry);
   }
  }catch(error){
   for(const entry of completed.reverse())try{
    if(entry.old===null)fs.unlinkSync(entry.file);
    else fs.writeFileSync(entry.file,entry.old);
   }catch(_){}
   throw error;
  }
 }
 return {status:check?"CHECKED":dryRun?"DRY_RUN_OK":remove?"REMOVED":"INSTALLED",
  files:plan.map(x=>({path:x.path,changed:x.old!==x.next}))};
}
if(require.main===module){
 try{
  const args=process.argv.slice(2),i=args.indexOf("--code-path");
  if(i<0||!args[i+1])throw Error("Usage: --code-path <disposable pinned EveJS/Code> [--dry-run|--check|--remove]");
  console.log(JSON.stringify(run({codePath:args[i+1],
   remove:args.includes("--remove"),dryRun:args.includes("--dry-run"),
   check:args.includes("--check")}),null,2));
 }catch(error){console.error("[COOP-048]",error.message);process.exitCode=1;}
}
module.exports={patch,run,RPC,STATE,EXT,PIN,TYPES,ARMS,INCLUDE};
