"use strict";
// LW-04D, READ-ONLY source and pinned checkout readiness. Never launches
// original EveJS, Rust, Docker or financial writers. No real E2E PASS.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),
 cp=require("node:child_process");
const PIN="c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f";
const TESTS=Object.freeze([
 "tests/coop-lw04d-original-native-chain-proof.test.mjs",
 "tests/coop-npc-industry-original-game-store-kernel.test.mjs",
 "tests/coop-npc-native-economy-director.test.mjs",
 "tests/coop-npc-factory-original-sale-finance-chain.test.mjs",
 "tests/coop-npc-industry-original-sale-audit.test.mjs",
 "tests/coop-npc-industry-original-wallet-witness.test.mjs",
 "tests/coop-npc-corporate-settlement.test.mjs",
 "tests/coop-npc-partial-fill-atomic.test.mjs",
 "tests/coop-native-industry-overlay-graph.test.mjs"
]);
const OVERLAY=Object.freeze(["coopNativeMiningAtomic","coopNativeHaulTransferAtomic",
 "coopNativeStationOreSettlement","coopNpcRefinery","coopNpcIndustryOfflineAtomic",
 "coopNpcIndustryNativeBindings","coopNpcNativeEconomyDirector",
 "coopNpcIndustryOriginalSaleAudit","coopNpcIndustryOriginalWalletWitness",
 "coopLivingWorldNativeChainProof"]);
const RUST=Object.freeze(["ReserveNpcSellOrder","ActivateNpcSellOrder",
 "GetNpcSellOrder","ClaimNpcSellOrder","FinalizeNpcSellOrder","GetNpcSellClaim"]);
function parse(argv){
 const opts={mode:"source"};
 for(let i=0;i<argv.length;i++){
  const value=argv[i];
  if(value==="--help"||value==="-h")opts.mode="help";
  else if(value==="--source"||value==="--native-preflight")opts.mode=value.slice(2);
  else if(value==="--upstream"||value==="--rust-source"){
   if(!argv[i+1]||argv[i+1].startsWith("--"))
    throw Error("LW04D_OPTION_VALUE_MISSING:"+value);
   opts[value.slice(2)]=argv[++i];
  }else throw Error("LW04D_UNKNOWN_ARGUMENT:"+value);
 }
 return opts;
}
const hash=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const within=(root,p)=>p===root||p.startsWith(root+path.sep);
function scanRust(dir,max=15000){
 const pending=[dir],found=new Set();let count=0;
 while(pending.length){
  const parent=pending.pop();
  for(const e of fs.readdirSync(parent,{withFileTypes:true})){
   if([".git","node_modules","target","dist","build","evejs-data"].includes(e.name))continue;
   if(e.isSymbolicLink())throw Error("LW04D_RUST_SYMLINK_REJECTED");
   const p=path.join(parent,e.name);
   if(e.isDirectory())pending.push(p);
   else if(e.isFile()&&p.endsWith(".rs")){
    if(++count>max)throw Error("LW04D_RUST_SCAN_BUDGET_EXCEEDED");
    const content=fs.readFileSync(p,"utf8");
    for(const n of RUST)if(content.includes(n))found.add(n);
   }
  }
 }
 if(count<1)throw Error("LW04D_NO_ORIGINAL_RUST_SOURCE");
 return{files:count,found:RUST.filter(n=>found.has(n)),
  missing:RUST.filter(n=>!found.has(n))};
}
function preflight({upstream,rustSource}={}){
 if(!upstream||!rustSource||!path.isAbsolute(upstream)||
    !path.isAbsolute(rustSource))
  throw Error("LW04D_EXPLICIT_ABSOLUTE_UPSTREAM_AND_RUST_SOURCE_REQUIRED");
 const code=fs.realpathSync(upstream),rust=fs.realpathSync(rustSource),
  project=path.resolve(__dirname,"..");
 if(within(project,code)||within(code,project))
  throw Error("LW04D_NATIVE_CHECKOUT_CANNOT_BE_OVERLAY_REPO");
 if(!within(code,rust)||!fs.statSync(rust).isDirectory())
  throw Error("LW04D_ORIGINAL_RUST_SOURCE_OUTSIDE_NATIVE_CHECKOUT");
 if(!fs.existsSync(path.join(code,"compose.yaml")))
  throw Error("LW04D_NATIVE_COMPOSE_MISSING");
 const revision=cp.execFileSync("git",
  ["-C",path.dirname(code),"rev-parse","HEAD"],
  {encoding:"utf8",timeout:10000}).trim();
 if(revision!==PIN)throw Error("LW04D_PINNED_ORIGINAL_EVEJS_REVISION_MISMATCH");
 const missing=[],drifted=[];
 for(const n of OVERLAY){
  const local=path.join(project,"integration",n+".cjs"),
   installed=path.join(code,"server","src","space",n+".js");
  if(!fs.existsSync(local)||!fs.existsSync(installed))missing.push(n);
  else if(hash(local)!==hash(installed))drifted.push(n);
 }
 if(missing.length||drifted.length)
  throw Error("LW04D_ORIGINAL_OVERLAY_MISSING_OR_DRIFTED:"+
   JSON.stringify({missing,drifted}));
 const symbols=scanRust(rust);
 if(symbols.missing.length)
  throw Error("LW04D_RUST_NPC_SELL_RPC_NOT_FOUND:"+symbols.missing.join(","));
 return {status:"READ_ONLY_PINNED_SOURCE_PREFLIGHT_PASS",pinnedRevision:revision,
  exactNativeOverlayCount:OVERLAY.length,rustFiles: symbols.files,
  rustSymbols: symbols.found,realRustRPC:"NOT_RUN",
  sqliteWal:"NOT_RUN",twoAuthenticatedClients:"NOT_RUN",realNativeE2E:false};
}
function sourceGate(){
 const root=path.resolve(__dirname,"..");
 for(const test of TESTS)if(!fs.existsSync(path.join(root,test)))
  throw Error("LW04D_SOURCE_TEST_MISSING:"+test);
 const cmd=cp.spawnSync(process.execPath,["--test",...TESTS],{
  cwd:root,encoding:"utf8",timeout:120000,
  env:{...process.env,EVEJS_COOP_ALIFE_ECONOMY_ACT:"0",
   EVEJS_COOP_NATIVE_NPC_MARKET:"0",
   EVEJS_COOP_NATIVE_NPC_ECONOMY_SCHEDULER:"0"}});
 process.stdout.write(cmd.stdout||"");
 process.stderr.write(cmd.stderr||"");
 if(cmd.error)throw cmd.error;
 if(cmd.status!==0)throw Error("LW04D_SOURCE_NODE_TESTS_FAILED:"+cmd.status);
 return{status:"SOURCE_TESTS_PASS",sourceTestFiles:TESTS.length,
  sqliteWal:"NOT_RUN",realRustRPC:"NOT_RUN",
  twoAuthenticatedClients:"NOT_RUN",realNativeE2E:false};
}
function main(argv){
 const o=parse(argv);
 if(o.mode==="help")return{usage:
  "node scripts/lw04d-native-readiness.cjs --source | --native-preflight --upstream /absolute/evejs --rust-source /absolute/evejs/rust",
  noMutation:true,realNativeE2E:false};
 if(o.mode==="source")return sourceGate();
 if(o.mode==="native-preflight")return preflight(o);
 throw Error("LW04D_UNKNOWN_MODE");
}
if(require.main===module){
 try{process.stdout.write(JSON.stringify(main(process.argv.slice(2)),null,2)+"\n")}
 catch(e){process.stderr.write("LW04D_BLOCKED: "+e.message+"\n");process.exitCode=1}
}
module.exports={parse,scanRust,preflight,sourceGate,main,PIN,TESTS,OVERLAY,RUST};
