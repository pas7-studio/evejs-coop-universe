"use strict";
// Run every pinned EveJS upstream contract in an independent disposable gameStore.
// Never touch the actual server's gameStore or persist the test DB after exit.
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {spawnSync}=require("node:child_process");
const args=process.argv.slice(2),flag=args.indexOf("--code-path"),sep=args.indexOf("--");
if(flag<0||!args[flag+1]||sep<0)throw Error("Usage: node Run-Isolated-Upstream-Tests.cjs --code-path <EveJS/Code> -- <test-file...>");
const code=fs.realpathSync(path.resolve(args[flag+1]));
if(!fs.existsSync(path.join(code,"server","src","gameStore","index.js")))throw Error("Not an EveJS Code checkout");
const files=args.slice(sep+1).map(x=>path.resolve(x));
if(!files.length)throw Error("At least one upstream test file is required");
let passed=0,failed=0;
for(const file of files){
 if(!fs.existsSync(file)||!path.basename(file).startsWith("upstream-")||!file.endsWith(".test.mjs"))throw Error("Expected existing upstream contract test: "+file);
 const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-coop-contract-"));
 try{
  const data=path.join(sandbox,"data");
  fs.mkdirSync(data,{recursive:true});
  // EveJS explicitly requires this attestation schema to prevent tests
  // from importing a live server database. Root is owned by mkdtemp().
  const attestation=path.join(sandbox,".evejs-test-store-attestation.json");
  fs.writeFileSync(attestation,JSON.stringify({
   schemaVersion:1,kind:"evejs-test-store",
   createdBy:"server/tests/helpers/isolatedGameStore.js",
   storeRoot:sandbox,dataDir:data
  }));
  const env={...process.env,EVEJS_CODE_PATH:code,
   EVEJS_TEST_STORE_ISOLATED:"1",
   EVEJS_TEST_STORE_ROOT:sandbox,
   EVEJS_GAMESTORE_DATA_DIR:data,
   EVEJS_TEST_STORE_ATTESTATION:attestation,
   EVEJS_SKIP_NPC_STARTUP:"1",
   EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE:"1"};
  delete env.EVEJS_TEST_STORE_BASELINE_ROOT;
  console.log("[UPSTREAM] "+path.basename(file)+" (isolated, disposable store)");
  const run=spawnSync(process.execPath,["--test","--test-concurrency=1",file],{
   env,cwd:path.dirname(file),stdio:"inherit",timeout:120000,windowsHide:true
  });
  if(run.error||run.status!==0){
   console.error("[FAIL]",path.basename(file),run.error?.message||"exit="+run.status);
   failed++;
  }else{console.log("[PASS]",path.basename(file));passed++;}
 }finally{
  fs.rmSync(sandbox,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 }
}
console.log("[UPSTREAM] Suites passed="+passed+" failed="+failed);
if(failed)process.exitCode=1;
