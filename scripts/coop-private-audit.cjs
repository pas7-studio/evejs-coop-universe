#!/usr/bin/env node
'use strict';
// Pure read-only CLI. Compose JSON comes from docker compose config --format json.
const fs=require('node:fs');
const {assess,parseNativeConfig,privatePeer}=require('../integration/coopPrivateHostSafety.cjs');
function main(argv=process.argv.slice(2),input=process.stdin){
  let nativePath='',peer='',json='';
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg==='--native-config'&&argv[i+1])nativePath=argv[++i];
    else if(arg==='--peer'&&argv[i+1])peer=argv[++i];
    else throw Error('USAGE: coop-private-audit.cjs --native-config <path> [--peer <private VPN IPv4>] < effective-compose.json');
  }
  if(!nativePath)throw Error('NATIVE_CONFIG_PATH_REQUIRED');
  const compose=JSON.parse(fs.readFileSync(0,'utf8'));
  const config=parseNativeConfig(fs.readFileSync(nativePath,'utf8'));
  const report=assess({compose,nativeConfig:config});
  if(peer&&!privatePeer(peer)){report.ok=false;report.errors.push('NON_PRIVATE_VPN_PEER');}
  // Never print config, env values, username, tokens, certs or secrets.
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  return report.ok?0:2;
}
if(require.main===module){try{process.exitCode=main();}catch(e){console.error('PRIVATE_AUDIT_FAILED: '+String(e?.message||e));process.exitCode=2;}}
module.exports={main};
