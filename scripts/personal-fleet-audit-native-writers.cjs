#!/usr/bin/env node
'use strict';
// PF48 strictly read-only local entrypoint; NO Docker, sqlite, game mutations.
const {inspectNativeWriterCoverage}=require('./lib/personal-fleet-native-writer-audit.cjs');
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--fork-root'||!args[1]){
 console.error('Usage: node scripts/personal-fleet-audit-native-writers.cjs --fork-root <absolute-or-relative-path-to-EveJS>');
 process.exitCode=64;
}else{
 try{
  const report=inspectNativeWriterCoverage({forkRoot:args[1]});
  console.log(JSON.stringify(report,null,2));
  // A source inventory is NOT an activation release signal.
  process.exitCode=2;
 }catch(error){console.error('PF48_AUDIT_UNAVAILABLE: '+String(error?.message||error));process.exitCode=3;}
}