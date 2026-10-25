import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const project=path.resolve(here,"..");
const isWindows=process.platform==="win32";

function runScript(name,args){
 const result=spawnSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",path.join(project,"scripts",name),...args],{encoding:"utf8"});
 return {status:result.status,output:(result.stdout||"")+(result.stderr||"")};
}

test("friend tunnel refuses a public peer address",t=>{
 if(!isWindows){t.skip("PowerShell is required");return;}
 const result=runScript("Start-Friend-Tunnel.ps1",["-Action","Check","-SshUser","coopguest","-HostVpnIPv4","8.8.8.8"]);
 assert.notEqual(result.status,0,"a public peer must not be accepted");
 assert.match(result.output,/not a private\/VPN address/);
 assert.match(result.output,/No public-IP forwarding/);
});

test("friend access preparation refuses to open a rule for a public peer",t=>{
 if(!isWindows){t.skip("PowerShell is required");return;}
 const result=runScript("Prepare-Friend-Access.ps1",["-FriendAddress","203.0.113.9"]);
 assert.notEqual(result.status,0,"a public peer must not be accepted");
 assert.match(result.output,/not a private\/VPN address/);
});

test("the VPN escape hatch stays documented and bounded",()=>{
 const tunnel=fs.readFileSync(path.join(project,"scripts","Start-Friend-Tunnel.ps1"),"utf8");
 assert.match(tunnel,/ExtraPeerRanges/);
 for(const range of ["10.0.0.0/8","172.16.0.0/12","192.168.0.0/16","100.64.0.0/10"])
  assert.ok(tunnel.includes(range),range+" must stay allowed");
 const doc=fs.readFileSync(path.join(project,"docs","FRIEND_PC_PRIVATE_TUNNEL.md"),"utf8");
 assert.match(doc,/-ExtraPeerRanges/);
 assert.match(doc,/Prepare-Friend-Access\.ps1/);
 assert.ok(fs.existsSync(path.join(project,"scripts","Prepare-Friend-Access.ps1")));
});

test("host preparation never publishes an EveJS port",()=>{
 const prepare=fs.readFileSync(path.join(project,"scripts","Prepare-Friend-Access.ps1"),"utf8");
 assert.doesNotMatch(prepare,/New-NetFirewallRule[\s\S]{0,400}?LocalPort\s+(26000|26001|26002|26003|443|5222|40110)\b/,
  "no firewall rule may open an EveJS port");
 assert.match(prepare,/loopback-only/);
});
