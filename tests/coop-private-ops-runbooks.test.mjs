import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {EXPECTED}=require('../integration/coopPrivateHostSafety.cjs');
const root=path.join(import.meta.dirname,'..');
const source=name=>fs.readFileSync(path.join(root,'scripts',name),'utf8');
const makeCompose=()=>({services:{
  init:{volumes:[{type:'volume',source:'evejs-data',target:'/var/lib/evejs'}]},
  market:{volumes:[{type:'volume',source:'evejs-data',target:'/var/lib/evejs'}],ports:Object.entries(EXPECTED.market).map(([published,target])=>({host_ip:'127.0.0.1',published,target}))},
  server:{volumes:[{type:'volume',source:'evejs-data',target:'/var/lib/evejs'}],ports:Object.entries(EXPECTED.server).map(([published,target])=>({host_ip:'127.0.0.1',published,target})),
   environment:{EVEJS_GAME_SERVER_HOST:'127.0.0.1',EVEJS_XMPP_CONNECT_HOST:'localhost',
    EVEJS_IMAGE_SERVER_URL:'http://127.0.0.1:26001/',
    EVEJS_MICROSERVICES_PUBLIC_BASE_URL:'http://127.0.0.1:26002/',
    EVEJS_MICROSERVICES_REDIRECT_URL:'http://127.0.0.1:26002/',
    EVEJS_MARKET_DAEMON_HOST:'market',EVEJS_MARKET_DAEMON_PORT:'40111'}}}});
function runCli(native){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eve41-'));
 try{
  const file=path.join(dir,'evejs.config.local.json');fs.writeFileSync(file,native);
  const run=spawnSync(process.execPath,[path.join(root,'scripts/coop-private-audit.cjs'),'--native-config',file],
   {input:JSON.stringify(makeCompose()),encoding:'utf8',timeout:7000});
  return {status:run.status,stdout:run.stdout,stderr:run.stderr};
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('CLI accepts approved private compose and native explicit auth flags',()=>{
 const r=runCli('{"devAutoCreateAccounts":false,"devSkipPasswordValidation":false,"devBypassAssetSafetyWrapAccess":false,"upwellGmBypassRestrictions":false}');
 assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).ok,true);
});
test('CLI refuses insecure native auth and never prints entire local source configuration',()=>{
 const r=runCli('{"devAutoCreateAccounts":true,"devSkipPasswordValidation":true,"devBypassAssetSafetyWrapAccess":false,"upwellGmBypassRestrictions":false,"password":"TOP_SECRET_DONT_LOG"}');
 assert.equal(r.status,2,r.stderr);assert.match(r.stdout,/UNSAFE_NATIVE_CONFIG_devSkipPasswordValidation/);
 assert.doesNotMatch(r.stdout,/TOP_SECRET_DONT_LOG/);
});
test('CLI refuses missing native config rather than assuming secure defaults',()=>{
 const run=spawnSync(process.execPath,[path.join(root,'scripts/coop-private-audit.cjs')],{input:JSON.stringify(makeCompose()),encoding:'utf8'});
 assert.equal(run.status,2);assert.match(run.stderr,/NATIVE_CONFIG_PATH_REQUIRED/);
});
test('PowerShell network host check does not modify firewall or Docker',()=>{
 const script=source('Verify-Private-Coop.ps1');
 assert.match(script,/docker compose @composeArgs config --format json/);
 assert.match(script,/Get-NetTCPConnection/);
 assert.doesNotMatch(script,/New-NetFirewallRule|Set-NetFirewallRule|docker compose up|docker compose down|docker volume create/);
});
test('tunnel probes are TCP-only and restrict peer to private mesh ranges',()=>{
 const script=source('Measure-Private-CoopLink.ps1');
 assert.match(script,/if \(-not \$allowed\) \{ throw 'Public SSH IP refused/);
 assert.match(script,/BeginConnect/);
 assert.doesNotMatch(script,/New-NetFirewallRule|docker compose up|Import-Certificate/);
});
test('backup never archives live mount; requires source volume existence and read-only volume mounting',()=>{
 const script=source('Coop-Volume-Safeguard.ps1');
 assert.match(script,/Assert-VolumeStopped \$vol\.Source/);
 assert.match(script,/docker volume inspect \$Name/);
 assert.match(script,/source=\$\(\$entry.Source\),target=\/source,readonly/);
 assert.match(script,/--network','none','--read-only/);
 assert.match(script,/ExpectedUtilityImageId/);
 assert.doesNotMatch(script,/docker compose down -v|docker volume rm|docker compose up/);
});
test('restore never writes original volume and requires explicit Apply plus new name',()=>{
 const script=source('Coop-Volume-Safeguard.ps1');
 assert.match(script,/RestoreToNew/);
 assert.match(script,/\$DestinationSuffix/);
 assert.match(script,/if \(-not \$Apply\)/);
 assert.match(script,/volume inspect \$newName/);
 assert.match(script,/type=volume,source=\$\(\$entry.Destination\),target=\/restore/);
});
test('backup manifest checks both archive SHA256 and byte length',()=>{
 const script=source('Coop-Volume-Safeguard.ps1');
 assert.match(script,/Get-FileHash -LiteralPath \$full -Algorithm SHA256/);
 assert.match(script,/\(Get-Item -LiteralPath \$full\)\.Length/);
});
test('dry-run overlay upgrade requires exact upstream SHA, preapproved backup, private configuration gate and dry run',()=>{
 const script=source('Plan-Private-Coop-Update.ps1');
 assert.match(script,/rev-parse HEAD/);
 assert.match(script,/c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f/);
 assert.match(script,/Coop-Volume-Safeguard\.ps1/);
 assert.match(script,/Verify-Private-Coop\.ps1/);
 assert.match(script,/Install-Coop-RuntimeProbe\.ps1.*-DryRun/);
 assert.doesNotMatch(script,/docker compose up|docker compose build|Deploy-Coop-RuntimeProbe\.ps1'\) -/);
});
