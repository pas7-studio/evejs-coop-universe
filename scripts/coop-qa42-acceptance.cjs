'use strict';
/**
 * Chat 42 — evidence-grade gate for real native EveJS gameplay.
 * Read-only. Never connects to game servers, modifies volumes, triggers CI,
 * invents an EVE client, or upgrades operator attestations into runtime PASS.
 * A cryptographic digest points to private evidence; it does not attest that
 * the evidence is genuine. Human review is always required for game PASS.
 */
const fs=require('node:fs');
const path=require('node:path');
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const TIERS=['source','unit','integration','runtime','oneClient','twoClient','restart'];
const SOURCE_KINDS=new Set(['source','unit','overlay','server','clientA','clientB',
  'serverBefore','serverAfter','inventoryBefore','inventoryAfter',
  'walletBefore','walletAfter','rust']);
function safeObject(v) { return Boolean(v&&typeof v==='object'&&!Array.isArray(v)); }
function safeId(v) { return typeof v==='string'&&/^[A-Za-z0-9_.-]{8,128}$/.test(v); }
function assertMatrix(m){
 if(!safeObject(m)||m.schema!=='coop-qa42-matrix/v1'||!SHA.test(m.upstreamPin))
  throw Error('QA42_BAD_MATRIX_HEADER');
 if(!Array.isArray(m.owners)||m.owners.length!==41||!Array.isArray(m.cases)||m.cases.length<40)
  throw Error('QA42_INCOMPLETE_OWNER_OR_CASE_MATRIX');
 const owners=new Set();
 for(const row of m.owners){
  if(!Number.isInteger(row.owner)||row.owner<1||row.owner>41||
     owners.has(row.owner)||typeof row.title!=='string'||!row.title.trim()||
     !Array.isArray(row.caseIDs)||!row.unit||!row.integration||!row.runtime||!row.twoClient)
    throw Error('QA42_OWNER_MATRIX_INVALID');
  owners.add(row.owner);
  if(String(row.twoClient.status).includes('PASS'))throw Error('QA42_UNSUPPORTED_DUO_PASS');
 }
 for(let i=1;i<=41;i++)if(!owners.has(i))throw Error('QA42_MISSING_OWNER_'+i);
 const caseIDs=new Set();
 for(const row of m.cases){
  if(!safeObject(row)||typeof row.id!=='string'||!/^QA42-[A-Z0-9_]+$/.test(row.id)||
    caseIDs.has(row.id)||typeof row.title!=='string'||!row.title.trim()||
    !TIERS.includes(row.minimumTier)||!Array.isArray(row.owners)||!row.owners.length||
    row.owners.some(x=>!owners.has(x))||!Array.isArray(row.requiredKinds)||
    !row.requiredKinds.length||new Set(row.requiredKinds).size!==row.requiredKinds.length||
    row.requiredKinds.some(x=>!SOURCE_KINDS.has(x))||!row.invariant||
    row.status!=='NOT_TESTED')throw Error('QA42_INVALID_CASE_'+String(row.id));
  caseIDs.add(row.id);
 }
 for(const row of m.owners){
  const expected=m.cases.filter(c=>c.owners.includes(row.owner)).map(c=>c.id).sort();
  if(JSON.stringify(expected)!==JSON.stringify([...row.caseIDs].sort()))throw Error('QA42_OWNER_CASE_LINK_MISMATCH_'+row.owner);
 }
 return true;
}
function assertSnapshot(snapshot,matrix){
 if(!safeObject(snapshot)||snapshot.schema!=='coop-qa42-snapshot/v1'||
   !SHA.test(snapshot.auditHeadAtSnapshot)||!SHA.test(snapshot.publishedStateRev)||
   !SHA.test(snapshot.upstreamPin)||snapshot.upstreamPin!==matrix.upstreamPin||
   !Number.isSafeInteger(snapshot.reportedServerEventsHistorical)||
   snapshot.reportedServerEventsHistorical<0||
   snapshot.verifiedSecondIndependentAuthenticatedClient!==false)
  throw Error('QA42_INVALID_SOURCE_SNAPSHOT');
 return true;
}
function getSourceQuality(snapshot,currentRev){
 const reasons=[];
 if(!SHA.test(currentRev))reasons.push('CURRENT_REVISION_NOT_VERIFIED');
 if(SHA.test(currentRev)&&currentRev!==snapshot.auditHeadAtSnapshot)
  reasons.push('QA_SNAPSHOT_NOT_CURRENT_FOR_HEAD');
 if(snapshot.publishedStateRev!==currentRev)reasons.push('PUBLISHED_GAMEPLAY_STATE_IS_STALE');
 if(snapshot.stateDigestPresentInMain===false)
  reasons.push('PUBLISHED_DIGEST_MISSING_FROM_GIT');
 if(Array.isArray(snapshot.forbiddenWorkflowsObserved)&&snapshot.forbiddenWorkflowsObserved.length)
  reasons.push('FORBIDDEN_GITHUB_ACTIONS_WORKFLOWS_PRESENT');
 if(snapshot.noDirectHostOrAuthorizedClientAccess)reasons.push('NO_DIRECT_SERVER_CLIENT_OBSERVATION');
 return {status:reasons.length?'SOURCE_INCOMPLETE':'SOURCE_CONSISTENT',reasons};
}
function validateTwoClients(players){
 if(!safeObject(players)||!safeObject(players.A)||!safeObject(players.B))
  return ['TWO_AUTHENTICATED_CLIENTS_REQUIRED'];
 const errors=[];
 for(const key of ['sessionFingerprint','characterFingerprint','clientFingerprint','accountFingerprint']){
  if(!safeId(players.A[key])||!safeId(players.B[key])||players.A[key]===players.B[key])
   errors.push('NONINDEPENDENT_OR_UNATTESTED_'+key.toUpperCase());
 }
 if(players.A.solarSystemID!==undefined||players.B.solarSystemID!==undefined){
  const a=players.A.solarSystemID,b=players.B.solarSystemID;
  if(!Number.isSafeInteger(a)||a<=0||a!==b)errors.push('NO_COMMON_SOLAR_SYSTEM');
 }
 if(players.A.shipFingerprint!==undefined||players.B.shipFingerprint!==undefined){
  if(!safeId(players.A.shipFingerprint)||!safeId(players.B.shipFingerprint)||
    players.A.shipFingerprint===players.B.shipFingerprint)errors.push('SHIPS_NOT_DISTINCT');
 }
 return errors;
}
function validateClaim(claim,scenario,matrix,currentRev){
 const errors=[];
 if(!safeObject(claim)||claim.caseID!==scenario.id) return ['INVALID_CASE_CLAIM'];
 if(claim.projectRev!==currentRev||claim.upstreamPin!==matrix.upstreamPin)
  errors.push('EVIDENCE_REVISION_OR_PIN_MISMATCH');
 if(claim.operatorObserved!==true||typeof claim.operatorLabel!=='string'||
   claim.operatorLabel.trim().length<3)
  errors.push('INDEPENDENT_OPERATOR_OBSERVATION_MISSING');
 if(!safeId(claim.correlationFingerprint))errors.push('CORRELATION_FINGERPRINT_MISSING');
 const at=Date.parse(claim.observedAt);
 if(!Number.isFinite(at)||typeof claim.observedAt!=='string'||
    !/^\d{4}-\d\d-\d\dT/.test(claim.observedAt)) errors.push('OBSERVATION_TIME_INVALID');
 if(!Array.isArray(claim.refs))errors.push('NO_EVIDENCE_REFS');
 else {
  const evidenceKinds=new Set();
  for(const ref of claim.refs){
   if(!safeObject(ref)||!SOURCE_KINDS.has(ref.kind)||!DIGEST.test(ref.sha256)||
      typeof ref.sourceType!=='string'||!['native-server-event','eve-client-log','ui-inspection','native-inventory','sqlite-or-rust','local-manual-test','overlay-dryrun','pinned-source'].includes(ref.sourceType)){
    errors.push('INVALID_EVIDENCE_REFERENCE');continue;
   }
   if(evidenceKinds.has(ref.kind))errors.push('DUPLICATE_EVIDENCE_KIND_'+ref.kind);
   evidenceKinds.add(ref.kind);
  }
  for(const kind of scenario.requiredKinds)if(!evidenceKinds.has(kind))
   errors.push('REQUIRED_EVIDENCE_MISSING_'+kind);
 }
 const needsDuo=['twoClient','restart'].includes(scenario.minimumTier)||
  scenario.requiredKinds.includes('clientB');
 if(needsDuo)errors.push(...validateTwoClients(claim.players));
 if(scenario.minimumTier==='restart'){
  if(!safeId(claim.beforeBootFingerprint)||!safeId(claim.afterBootFingerprint)||
     claim.beforeBootFingerprint===claim.afterBootFingerprint)
    errors.push('NO_DISTINCT_RESTART_BOOT_WITNESSES');
 }
 if(claim.claimedStatus==='PASS'||claim.claimedStatus==='DONE')
  errors.push('UNREVIEWED_AUTO_PASS_FORBIDDEN');
 return [...new Set(errors)];
}
function assess({matrix,snapshot,claims={schema:'coop-qa42-claims/v1',claims:[]},currentRev}={}){
 assertMatrix(matrix);assertSnapshot(snapshot,matrix);
 if(!safeObject(claims)||claims.schema!=='coop-qa42-claims/v1'||!Array.isArray(claims.claims))
  throw Error('QA42_INVALID_CLAIMS_DOCUMENT');
 const seen=new Set(),claimByCase=new Map();
 for(const claim of claims.claims){
  if(!safeObject(claim)||typeof claim.caseID!=='string'||seen.has(claim.caseID))
   throw Error('QA42_DUPLICATE_OR_INVALID_CLAIM');
  if(!matrix.cases.some(row=>row.id===claim.caseID))throw Error('QA42_UNKNOWN_CASE');
  seen.add(claim.caseID);claimByCase.set(claim.caseID,claim);
 }
 const source=getSourceQuality(snapshot,currentRev||snapshot.auditHeadAtSnapshot);
 const cases=matrix.cases.map(scenario=>{
  const claim=claimByCase.get(scenario.id);
  if(!claim)return {id:scenario.id,owners:scenario.owners,status:'NOT_TESTED',reasons:['NO_CURRENT_OBSERVATION']};
  const errors=validateClaim(claim,scenario,matrix,currentRev||snapshot.auditHeadAtSnapshot);
  if(source.reasons.includes('QA_SNAPSHOT_NOT_CURRENT_FOR_HEAD'))errors.push('QA_SNAPSHOT_NOT_CURRENT_FOR_HEAD');
  return {id:scenario.id,owners:scenario.owners,
    status:errors.length?'REJECTED_EVIDENCE':'REVIEW_REQUIRED',reasons:[...new Set(errors)]};
 });
 const counts=Object.fromEntries(['NOT_TESTED','REJECTED_EVIDENCE','REVIEW_REQUIRED','PASS_VERIFIED'].map(s=>[s,cases.filter(x=>x.status===s).length]));
 return {schema:'coop-qa42-report/v1',auditedRevision:currentRev||snapshot.auditHeadAtSnapshot,
  publishedGameRev:snapshot.publishedStateRev,upstreamPin:matrix.upstreamPin,
  ownerDirections:matrix.owners.length,acceptanceCases:cases.length,
  evidencePolicy:'SOURCE_AND_ATTESTATION_ONLY_REQUIRE_HUMAN_INSPECTION',
  source,counts,unitIsolatedReruns:snapshot.independentlyRerunIsolated,
  twoAuthenticatedClientsVerified:false,overall:'NO_GO_NOT_PROVEN_COMPLETE',cases};
}
function parseArgs(argv){
 const args={};
 for(let i=0;i<argv.length;i++){
  const flag=argv[i];
  if(!['--matrix','--snapshot','--claims','--current-rev','--strict'].includes(flag))throw Error('QA42_UNKNOWN_ARG_'+flag);
  if(flag==='--strict'){args.strict=true;continue;}
  if(i+1>=argv.length||argv[i+1].startsWith('--'))throw Error('QA42_MISSING_ARG_'+flag);
  args[flag.slice(2)]=argv[++i];
 }
 return args;
}
if(require.main===module){
 try{
  const opts=parseArgs(process.argv.slice(2));
  const dir=path.resolve(__dirname,'..');
  const matrix=JSON.parse(fs.readFileSync(opts.matrix||path.join(dir,'qa/CHAT42_ACCEPTANCE_MATRIX.json'),'utf8'));
  const snapshot=JSON.parse(fs.readFileSync(opts.snapshot||path.join(dir,'qa/CHAT42_SOURCE_SNAPSHOT.json'),'utf8'));
  const claims=opts.claims?JSON.parse(fs.readFileSync(opts.claims,'utf8')):undefined;
  const result=assess({matrix,snapshot,claims,currentRev:opts['current-rev']});
  console.log(JSON.stringify(result,null,2));
  if(opts.strict&&result.overall!=='PASS_VERIFIED')process.exitCode=2;
 }catch(e){console.error('QA42_EVIDENCE_VALIDATION_ERROR:',e.message);process.exitCode=2;}
}
module.exports={assertMatrix,assertSnapshot,getSourceQuality,validateTwoClients,validateClaim,assess,parseArgs,TIERS};
