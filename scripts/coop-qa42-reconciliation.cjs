'use strict';
/**
 * QA42 read-only, revision-aware reconciliation of source, state evidence,
 * forbidden CI, and native feature hook assembly. This tool never runs game
 * code, GitHub Actions, modifies data, or awards a gameplay PASS.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {assertMatrix}=require('./coop-qa42-acceptance.cjs');
const SHA=/^[0-9a-f]{40}$/;
const HASH=/^[0-9a-f]{64}$/;
const GATE='NO_GO_NOT_PROVEN_COMPLETE';
const nativeHooks=Object.freeze([
 {owner:10,module:'coopEwarDogmaCorrections',helper:'coop-ewar-dogma-patch.cjs'},
 {owner:21,module:'coopNativePveObjectiveGuard',helper:'coop-pve-native-objective-patch.cjs'},
 {owner:28,module:'coopMoonExtractionReadAccess',helper:'coop-moon-extraction-read-patch.cjs'},
 {owner:28,module:'coopMoonFuelOutputFence',helper:'coop-moon-fuel-output-patch.cjs'},
 {owner:35,module:'coopFwEnlistmentGate',helper:'coop-fw-native-enlistment-patch.cjs'},
 {owner:35,module:'coopFwInsurgencyVisibility',helper:'coop-fw-insurgency-visibility-patch.cjs'},
]);
const hash=buf=>crypto.createHash('sha256').update(buf).digest('hex');
const read=(root,p)=>fs.readFileSync(path.join(root,p));
const readText=(root,p)=>read(root,p).toString('utf8');
function gitHead(root){
 try {
  const s=execFileSync('git',['-C',root,'rev-parse','--verify','HEAD'],{
   encoding:'utf8',timeout:5000,stdio:['ignore','pipe','ignore']}).trim();
  return SHA.test(s)?s:null;
 }catch(_error){return null;}
}
function tracked(root,p){
 try {execFileSync('git',['-C',root,'ls-files','--error-unmatch','--',p],{
  encoding:'utf8',timeout:5000,stdio:['ignore','pipe','ignore']});return true;
 }catch(_error){return false;}
}
function safeManifestPath(p){
 if(typeof p!=='string'||!p.startsWith('state/')||p.includes('\\')||p.includes('\0'))return false;
 const segments=p.split('/');
 return segments.every(s=>s!=='.'&&s!=='..'&&s.length>0);
}
function inspectState(root,revision,{requireTracked=true}={}){
 const summary={publication:'UNKNOWN',publishedRev:null,manifestIntegrity:'INVALID',
  entries:[],errors:[]};
 let status,manifest;
 try {status=JSON.parse(readText(root,'state/status.json'));}
 catch(_error){summary.errors.push('STATE_STATUS_MISSING_OR_INVALID');}
 try {manifest=JSON.parse(readText(root,'state/manifest.json'));}
 catch(_error){summary.errors.push('STATE_MANIFEST_MISSING_OR_INVALID');}
 if(!status||!manifest)return summary;
 const publishedRev=status.projectRev;
 summary.publishedRev=SHA.test(publishedRev)?publishedRev:null;
 if(!summary.publishedRev)summary.errors.push('STATE_REVISION_INVALID');
 if(!SHA.test(revision))summary.errors.push('CURRENT_REVISION_NOT_VERIFIED');
 else if(summary.publishedRev!==revision)summary.errors.push('STATE_REVISION_STALE');
 if(!Array.isArray(manifest.files)||!manifest.files.length){
  summary.errors.push('STATE_MANIFEST_EMPTY');return summary;
 }
 const names=new Set();
 for(const entry of manifest.files){
  const p=entry&&entry.path;
  const result={path:typeof p==='string'?p:null,integrity:'INVALID'};
  if(!safeManifestPath(p)||names.has(p)||!HASH.test(entry.sha256)||
    !Number.isSafeInteger(entry.bytes)||entry.bytes<0){
    summary.errors.push('STATE_MANIFEST_INVALID_ENTRY');
  }else{
   names.add(p);
   try{
    const buf=read(root,p);
    if(requireTracked&&!tracked(root,p)){
     result.integrity='NOT_TRACKED';summary.errors.push('STATE_EVIDENCE_NOT_TRACKED');
    }else if(buf.length!==entry.bytes||hash(buf)!==entry.sha256){
     result.integrity='DIGEST_MISMATCH';summary.errors.push('STATE_EVIDENCE_DIGEST_MISMATCH');
    }else result.integrity='HASH_MATCH';
   }catch(_error){result.integrity='MISSING';summary.errors.push('STATE_EVIDENCE_MISSING');}
  }
  summary.entries.push(result);
 }
 if(!names.has('state/status.json'))summary.errors.push('STATE_STATUS_NOT_MANIFESTED');
 if(!names.has('state/NOW.md'))summary.errors.push('STATE_NOW_NOT_MANIFESTED');
 if(!summary.entries.some(x=>x.path&&x.path.startsWith('state/digests/')))
  summary.errors.push('STATE_RUN_DIGEST_NOT_MANIFESTED');
 summary.errors=[...new Set(summary.errors)];
 summary.manifestIntegrity=summary.entries.every(e=>e.integrity==='HASH_MATCH')?'HASH_MATCH':'INCOMPLETE';
 summary.publication=summary.errors.length?'STALE_OR_INCOMPLETE':'SOURCE_MANIFEST_MATCH';
 return summary;
}
function inspectWorkflows(root){
 const dir=path.join(root,'.github','workflows');
 let present=[];
 if(fs.existsSync(dir))present=fs.readdirSync(dir,{withFileTypes:true})
  .filter(x=>x.isFile()&&/\.ya?ml$/i.test(x.name)).map(x=>'.github/workflows/'+x.name).sort();
 let forbidden=false;
 try {forbidden=/no.?ci|do not add.*github actions|do not.*github actions/i.test(readText(root,'AGENTS.md'));}
 catch(_error){/* cannot attest policy */}
 return {policyRead:forbidden,workflows:present,
  status:forbidden&&present.length?'OWNER_NO_CI_CONFLICT':
   forbidden?'NO_WORKFLOW_VIOLATION_DETECTED':'OWNER_POLICY_UNVERIFIED'};
}
function inspectHooks(root){
 let installer;
 try {installer=readText(root,'scripts/patch-evejs-coop.cjs');}
 catch(_error){return nativeHooks.map(h=>({...h,sourceModule:false,helperPresent:false,
  moduleRegistered:false,helperInvokedInInstaller:false,status:'INSTALLER_UNAVAILABLE'}));}
 return nativeHooks.map(h=>{
  const sourceModule=fs.existsSync(path.join(root,'integration',h.module+'.cjs'));
  const helperPresent=fs.existsSync(path.join(root,'scripts',h.helper));
  // Source registration is NOT a native source hook. Keep the two distinct.
  const moduleRegistered=installer.includes('"'+h.module+'"')||installer.includes("'"+h.module+"'");
  const escaped=h.helper.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const helperInvokedInInstaller=new RegExp('require\\s*\\(\\s*[\"\\\']\\./'+escaped+'[\"\\\']\\s*\\)').test(installer);
  return {...h,sourceModule,helperPresent,moduleRegistered,helperInvokedInInstaller,
   status:!sourceModule||!helperPresent?'SOURCE_PACKAGE_INCOMPLETE':
    !moduleRegistered?'NOT_REGISTERED':
    !helperInvokedInInstaller?'COPIED_ONLY_HOOK_NOT_ASSEMBLED':'SOURCE_HOOK_REFERENCED_NOT_DEPLOYMENT_PROOF'};
 });
}
function inspect({root,revision=null,requireTracked=true}={}){
 if(typeof root!=='string'||!root)throw Error('QA42_REPO_ROOT_REQUIRED');
 const current=SHA.test(revision)?revision:null;
 const state=inspectState(root,current,{requireTracked});
 const workflows=inspectWorkflows(root);
 const hooks=inspectHooks(root);
 let matrix;
 try {
  matrix=JSON.parse(readText(root,'qa/CHAT42_ACCEPTANCE_MATRIX.json'));
  assertMatrix(matrix);
 }catch(error){throw Error('QA42_ACCEPTANCE_MATRIX_INVALID: '+error.message);}
 const openHookCount=hooks.filter(h=>h.status==='COPIED_ONLY_HOOK_NOT_ASSEMBLED').length;
 return {schema:'coop-qa42-reconciliation/v1',revision:current,pin:matrix.upstreamPin,
  independentOwners:matrix.owners.length,scenarios:matrix.cases.length,
  inputTrust:'LOCAL_REPO_SOURCE_ONLY_NOT_A_NATIVE_CLIENT_OBSERVATION',
  state,workflows,hooks,openHookCount,
  blockers:[
   ...state.errors,
   ...(workflows.status==='OWNER_NO_CI_CONFLICT'?['FORBIDDEN_GITHUB_ACTIONS_PRESENT']:[]),
   ...hooks.filter(h=>h.status!=='SOURCE_HOOK_REFERENCED_NOT_DEPLOYMENT_PROOF')
    .map(h=>'HOOK_'+h.owner+'_'+h.module+'_'+h.status),
   'NO_CURRENT_TWO_AUTHENTICATED_CLIENTS_ATTESTED',
   'NO_CURRENT_ISOLATED_CRASH_RESTART_SETTLEMENT_ATTESTED',
  ],
  unitStatus:'NOT_EXECUTED_BY_THIS_READ_ONLY_INSPECTION',
  nativeRuntimeStatus:'NOT_OBSERVED',twoClientStatus:'NOT_OBSERVED',
  verdict:GATE};
}
function parseArgs(args){
 const opts={strict:false,root:path.resolve(__dirname,'..'),expectedHead:null};
 for(let i=0;i<args.length;i++){
  if(args[i]==='--strict'){opts.strict=true;continue;}
  if(args[i]==='--root'&&i+1<args.length){opts.root=path.resolve(args[++i]);continue;}
  if(args[i]==='--expected-head'&&i+1<args.length){opts.expectedHead=args[++i];continue;}
  throw Error('QA42_RECONCILIATION_UNKNOWN_ARG');
 }
 if(opts.expectedHead!==null&&!SHA.test(opts.expectedHead))throw Error('QA42_EXPECTED_HEAD_INVALID');
 return opts;
}
if(require.main===module){
 try {
  const opts=parseArgs(process.argv.slice(2));
  const revision=gitHead(opts.root);
  if(opts.expectedHead&&revision!==opts.expectedHead)throw Error('QA42_CHECKOUT_HEAD_MISMATCH');
  const result=inspect({root:opts.root,revision,requireTracked:true});
  console.log(JSON.stringify(result,null,2));
  if(opts.strict&&result.verdict!== 'PASS_VERIFIED')process.exitCode=2;
 }catch(error){console.error('QA42_RECONCILIATION_ERROR:',error.message);process.exitCode=2;}
}
module.exports={inspect,inspectState,inspectWorkflows,inspectHooks,gitHead,parseArgs,safeManifestPath,nativeHooks};
