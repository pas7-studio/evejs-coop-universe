"use strict";
// Local regression baseline. There is no CI: this tool makes "17 known
// failures" explicit so a NEW failure cannot hide inside the noise.
//
//   node scripts/coop-test-baseline.cjs            # compare against the baseline
//   node scripts/coop-test-baseline.cjs --record   # rewrite the baseline
//   node scripts/coop-test-baseline.cjs --include-upstream
//
// The baseline stores only failing test names plus totals, so unrelated
// passing tests never churn the file. Exit code 1 means a regression.
const fs=require("node:fs"),path=require("node:path"),{spawnSync}=require("node:child_process");
const project=path.resolve(__dirname,"..");
const baselinePath=path.join(project,"docs","evidence","test-baseline.json");
const args=process.argv.slice(2);
const record=args.includes("--record");
const includeUpstream=args.includes("--include-upstream");

function discover(){
 const dir=path.join(project,"tests");
 return fs.readdirSync(dir)
  .filter(name=>name.endsWith(".test.mjs"))
  .filter(name=>includeUpstream||!name.startsWith("upstream-"))
  .sort();
}
function runOne(name){
 const result=spawnSync(process.execPath,["--test","--test-reporter=tap",path.join(project,"tests",name)],{
  encoding:"utf8",maxBuffer:64*1024*1024
 });
 const output=(result.stdout||"")+(result.stderr||"");
 const counts={pass:0,fail:0,skipped:0};
 for(const key of Object.keys(counts)){
  const match=output.match(new RegExp("^# "+key+" (\\d+)$","m"));
  if(match)counts[key]=Number(match[1]);
 }
 const failures=[...output.matchAll(/^not ok \d+ - (.+?)(?: # SKIP.*)?$/gm)]
  .map(match=>match[1].trim())
  .filter(line=>line!==name&&!line.startsWith("tests\\")&&!line.startsWith("tests/"));
 const crashed=result.status!==0&&counts.fail===0&&counts.pass===0;
 return {...counts,failures,crashed,exitCode:result.status};
}
function summarize(runs){
 const failing={},totals={files:0,pass:0,fail:0,skipped:0,crashed:0};
 for(const [name,run] of Object.entries(runs)){
  totals.files++;
  totals.pass+=run.pass;totals.fail+=run.fail;totals.skipped+=run.skipped;
  if(run.crashed)totals.crashed++;
  if(run.fail>0||run.crashed)failing[name]={fail:run.fail,skipped:run.skipped,crashed:run.crashed,failures:run.failures};
 }
 return {totals,failing};
}
function gitRev(what){
 const result=spawnSync("git",["-C",what,"rev-parse","HEAD"],{encoding:"utf8"});
 return result.status===0?result.stdout.trim():"UNKNOWN";
}
const files=discover();
if(files.length<10)throw Error("Unexpectedly few test files: "+files.length);
const runs={};
for(const name of files){
 process.stdout.write(".");
 runs[name]=runOne(name);
}
process.stdout.write("\n");
const {totals,failing}=summarize(runs);
const upstream=process.env.EVEJS_COOP_CODE_PATH||null;

if(record){
 const baseline={
  recordedAt:new Date().toISOString(),
  nodeVersion:process.version,
  projectRev:gitRev(project),
  upstreamPin:require("./patch-evejs-coop.cjs").PIN,
  upstreamCheckout:upstream,
  scope:includeUpstream?"local+upstream":"local overlay only (upstream-* excluded)",
  totals,
  failing
 };
 fs.mkdirSync(path.dirname(baselinePath),{recursive:true});
 fs.writeFileSync(baselinePath,JSON.stringify(baseline,null,2)+"\n","utf8");
 console.log("Recorded baseline: "+path.relative(project,baselinePath));
 console.log(JSON.stringify(totals));
 process.exit(0);
}

if(!fs.existsSync(baselinePath))throw Error("No baseline yet. Run with --record first.");
const baseline=JSON.parse(fs.readFileSync(baselinePath,"utf8"));
const known=new Set(Object.keys(baseline.failing||{}));
const regressions=[];
const fixed=[];
for(const [name,run] of Object.entries(failing)){
 const before=baseline.failing[name];
 if(!before){regressions.push({file:name,newFailures:run.failures,reason:"file did not fail in the baseline"});continue;}
 const newNames=run.failures.filter(test=>!before.failures.includes(test));
 if(newNames.length||run.fail>before.fail)
  regressions.push({file:name,newFailures:newNames,reason:"failures increased ("+before.fail+" -> "+run.fail+")"});
}
for(const name of known){
 if(!failing[name])fixed.push(name);
 else if(failing[name].fail<baseline.failing[name].fail)fixed.push(name+" (partly)");
}
console.log(JSON.stringify({
 status:regressions.length?"REGRESSION":"BASELINE_MATCH",
 baselineRecordedAt:baseline.recordedAt,
 baselineTotals:baseline.totals,
 currentTotals:totals,
 newFailures:regressions,
 improvements:fixed
},null,2));
if(regressions.length)process.exitCode=1;
