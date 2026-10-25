"use strict";
// Explicit, offline-only creation of a SEPARATE Manifest starter-market donor.
// No access to or mutation of the active market.sqlite is required.
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {spawnSync}=require("node:child_process");
const SOURCE="/app/docker/market-seed.toml";
const CANDIDATE="/var/lib/evejs/market/coop-manifest.candidate.sqlite";
const SYSTEM=30100032;
function makeCandidateConfig(source){
 const regex=/^\s*database_path\s*=\s*"\/var\/lib\/evejs\/market\/market\.sqlite\.candidate"\s*$/gm;
 const hits=[...source.matchAll(regex)].length;
 if(hits!==1)throw Error("Unexpected pinned market seed output path; refusing to build");
 return source.replace(regex,`database_path = "${CANDIDATE}"`);
}
function checkCandidate(pathCandidate=CANDIDATE,Database){
 const DB=Database||require("/app/server/node_modules/better-sqlite3");
 const db=new DB(pathCandidate,{readonly:true,fileMustExist:true});
 try{
  db.pragma("query_only = ON");
  if(db.pragma("quick_check",{simple:true})!=="ok")throw Error("Candidate SQLite quick_check failed");
  const entry=db.prepare("SELECT value FROM manifest WHERE key='manifest_json'").get();
  const manifest=JSON.parse(entry?.value||"null");
  if(JSON.stringify(manifest?.selected_solar_system_ids)!==JSON.stringify([SYSTEM]))throw Error("Candidate is not scoped to Manifest");
  const stations=db.prepare("SELECT COUNT(*) AS n FROM stations WHERE solar_system_id=?").get(SYSTEM)?.n||0;
  const stocked=db.prepare("SELECT COUNT(*) AS n FROM seed_stock WHERE solar_system_id=? AND quantity>0").get(SYSTEM)?.n||0;
  if(!stations||!stocked)throw Error("Candidate has no real Manifest stock");
  return {status:"MANIFEST_CANDIDATE_VALID",stationCount:stations,stockedTypeRows:stocked};
 }finally{db.close();}
}
function run({build=false,source=SOURCE,candidate=CANDIDATE,readFile=fs.readFileSync,exists=fs.existsSync,spawn=spawnSync,makeTemp=fs.mkdtempSync,write=fs.writeFileSync,check=checkCandidate}={}){
 if(candidate!==CANDIDATE||source!==SOURCE)throw Error("Only the pinned Manifest candidate path is permitted");
 const config=makeCandidateConfig(readFile(source,"utf8"));
 if(exists(candidate)||exists(candidate+"-wal")||exists(candidate+"-shm"))throw Error("Candidate already exists; never replace it implicitly");
 if(!build)return {status:"MANIFEST_CANDIDATE_DRY_RUN",systemID:SYSTEM,sourceConfig:source,candidate,
  command:"market-seed build --force --solar-system-id 30100032",writes:false};
 if(process.env.EVEJS_COOP_MARKET_OFFLINE_LOCK_HELD!=="1")throw Error("Exclusive offline market lock not confirmed");
 const dir=makeTemp(path.join(os.tmpdir(),"coop-manifest-seed-"));
 try{
  const temp=path.join(dir,"seed.toml");write(temp,config,{flag:"wx",mode:0o600});
  const result=spawn("market-seed",["--config",temp,"build","--force","--solar-system-id",String(SYSTEM)],
    {stdio:"inherit",timeout:15*60*1000});
  if(result.error||result.status!==0)throw Error("Pinned market-seed candidate build failed; inspect candidate before any retry");
  return {...check(candidate),candidate,systemID:SYSTEM};
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
if(require.main===module){
 try{
  const args=process.argv.slice(2);
  if(args.length>1||args.some(x=>x!=="--build"))throw Error("Usage: node coop-market-build-candidate.cjs [--build]");
  console.log(JSON.stringify(run({build:args.includes("--build")}),null,2));
 }catch(e){console.error(JSON.stringify({status:"MANIFEST_CANDIDATE_BLOCKED",reason:String(e.message).slice(0,220)}));process.exitCode=2;}
}
module.exports={makeCandidateConfig,checkCandidate,run,SOURCE,CANDIDATE,SYSTEM};