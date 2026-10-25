import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {EXPECTED,privatePeer,parseNativeConfig,validateCompose,validateNativeConfig,
  validateTunnel,assess}=require('../integration/coopPrivateHostSafety.cjs');
const servicePorts=(name)=>Object.entries(EXPECTED[name]).map(([published,target])=>({host_ip:'127.0.0.1',published,target,protocol:'tcp'}));
function compose(){return {name:'evejs',services:{
  init:{volumes:[{type:'volume',source:'evejs-data',target:'/var/lib/evejs'}]},
  market:{ports:servicePorts('market'),volumes:[{type:'volume',source:'evejs-data',target:'/var/lib/evejs'}]},
  server:{ports:servicePorts('server'),volumes:[
    {type:'volume',source:'evejs-data',target:'/var/lib/evejs'},
    {type:'volume',source:'evejs-images',target:'/app/server/src/_secondary/image/generated'}],
    environment:{
      EVEJS_GAME_SERVER_HOST:'127.0.0.1',EVEJS_XMPP_CONNECT_HOST:'localhost',
      EVEJS_IMAGE_SERVER_URL:'http://127.0.0.1:26001/',
      EVEJS_MICROSERVICES_PUBLIC_BASE_URL:'http://127.0.0.1:26002/',
      EVEJS_MICROSERVICES_REDIRECT_URL:'http://127.0.0.1:26002/',
      EVEJS_MARKET_DAEMON_HOST:'market',EVEJS_MARKET_DAEMON_PORT:'40111'
    }}
  }};}
function config(){return {devAutoCreateAccounts:false,devSkipPasswordValidation:false,
  devBypassAssetSafetyWrapAccess:false,upwellGmBypassRestrictions:false,
  devHandshakeSeedSkillExtractorAccessToken:false};}
const tunnel=()=>({hostVpnIPv4:'100.93.2.10',sshPort:22,sshUser:'coopguest',
 hostKeyChecking:'yes',batchMode:'yes',gatewayPorts:'no',remoteName:'127.0.0.1',
 forwardings:[443,5222,26000,26001,26002].map(port=>({localHost:'127.0.0.1',remoteHost:'127.0.0.1',localPort:port,remotePort:port}))});
const errors=x=>x.errors.join(',');
test('private loopback five-port compose, disabled dev auth, key-only tunnel PASS',()=>{
 const result=assess({compose:compose(),nativeConfig:config(),tunnel:tunnel()});
 assert.equal(result.ok,true,errors(result));assert.deepEqual(result.errors,[]);
 assert.equal(result.gameVolume,'evejs-data');
});
test('native JSONC parser preserves URL literal and removes comments',()=>{
 const result=parseNativeConfig('/* yes */ {"devSkipPasswordValidation": false, // no\n "url":"http://127.0.0.1/a//b"}');
 assert.equal(result.devSkipPasswordValidation,false);
 assert.equal(result.url,'http://127.0.0.1/a//b');
});
test('pinned native devSkipPasswordValidation=true blocks private access',()=>{
 const c=config();c.devSkipPasswordValidation=true;
 assert.equal(assess({compose:compose(),nativeConfig:c}).ok,false);
 assert.match(errors(validateNativeConfig(c)),/UNSAFE_NATIVE_CONFIG_devSkipPasswordValidation/);
});
test('pinned native devAutoCreateAccounts=true blocks unauthorized new login',()=>{
 const c=config();c.devAutoCreateAccounts=true;
 assert.match(errors(validateNativeConfig(c)),/UNSAFE_NATIVE_CONFIG_devAutoCreateAccounts/);
});
test('accidental Compose wildcard publication is rejected even with published port unchanged',()=>{
 const c=compose();c.services.server.ports[2].host_ip='0.0.0.0';
 assert.match(errors(validateCompose(c)),/NON_LOOPBACK_PUBLICATION_server_26000/);
});
test('unqualified Compose host_ip is not treated as loopback',()=>{
 const c=compose();delete c.services.server.ports[2].host_ip;
 assert.equal(validateCompose(c).errors.some(x=>x.includes('NON_LOOPBACK_PUBLICATION')),true);
});
test('IPv6 :: listener and host network mode rejected',()=>{
 const c=compose();c.services.server.ports[0].host_ip='::';c.services.server.network_mode='host';
 const result=validateCompose(c);
 assert.equal(result.errors.some(x=>x.startsWith('NON_LOOPBACK_PUBLICATION')),true);
 assert.equal(result.errors.some(x=>x.startsWith('DANGEROUS_CONTAINER_ISOLATION')),true);
});
test('market internal 40111 or market diagnostics leak is not permitted',()=>{
 const c=compose();c.services.market.ports.push({host_ip:'127.0.0.1',published:'40111',target:40111});
 assert.match(errors(validateCompose(c)),/UNEXPECTED_COMPOSE_PORT_market_40111/);
});
test('no container may mount Docker socket',()=>{
 const c=compose();c.services.server.volumes.push({type:'bind',source:'/var/run/docker.sock',target:'/var/run/docker.sock'});
 assert.match(errors(validateCompose(c)),/DOCKER_SOCKET_MOUNT_server/);
});
test('same shared native GameStore volume across init market server is required',()=>{
 const c=compose();c.services.market.volumes[0].source='other';
 assert.match(errors(validateCompose(c)),/GAMESTORE_VOLUME_MISMATCH_market/);
});
test('anonymous or bind-mounted GameStore is not accepted',()=>{
 const c=compose();c.services.server.volumes[0].type='bind';
 assert.match(errors(validateCompose(c)),/GAMESTORE_NAMED_VOLUME_REQUIRED/);
});
test('generated portraits without a dedicated volume are explicitly warned',()=>{
 const c=compose();c.services.server.volumes.pop();
 assert.match(validateCompose(c).warnings.join(''),/GENERATED_CHARACTER_PORTRAITS_NOT_NAMED_VOLUME/);
});
test('hostnames in advertised image or microservice URL break localhost tunnel and fail',()=>{
 const c=compose();c.services.server.environment.EVEJS_IMAGE_SERVER_URL='https://vpn.example.test:26001/';
 assert.match(errors(validateCompose(c)),/NON_LOOPBACK_ADVERTISEMENT_EVEJS_IMAGE_SERVER_URL/);
});
test('malicious redirect or basic-auth URL is never considered loopback',()=>{
 const c=compose();c.services.server.environment.EVEJS_MICROSERVICES_REDIRECT_URL='http://127.0.0.1@public.example/';
 assert.match(errors(validateCompose(c)),/NON_LOOPBACK_ADVERTISEMENT_EVEJS_MICROSERVICES_REDIRECT_URL/);
});
test('environment auth bypass overrides are rejected even if native config is safe',()=>{
 const c=compose();c.services.server.environment.EVEJS_DEV_SKIP_PASSWORD_VALIDATION='true';
 assert.match(errors(validateCompose(c)),/UNSAFE_AUTH_ENV_EVEJS_DEV_SKIP_PASSWORD_VALIDATION/);
});
test('environment array representation in Compose is correctly parsed',()=>{
 const c=compose();c.services.server.environment=Object.entries(c.services.server.environment).map(x=>x.join('='));
 assert.equal(validateCompose(c).errors.length,0,errors(validateCompose(c)));
});
test('missing expected XMPP/chat or HTTPS forward causes fail',()=>{
 const c=compose();c.services.server.ports=c.services.server.ports.filter(x=>x.published!=='5222');
 assert.match(errors(validateCompose(c)),/REQUIRED_LOOPBACK_PORT_MISSING_server_5222/);
});
test('public IPs and loopback are not accepted as authenticated VPN peers',()=>{
 for(const addr of ['8.8.8.8','1.1.1.1','127.0.0.1','0.0.0.0','169.254.169.254','::1'])
   assert.equal(privatePeer(addr),false,addr);
 for(const addr of ['10.1.2.3','172.31.255.254','192.168.200.1','100.127.255.254','100.64.0.1'])
   assert.equal(privatePeer(addr),true,addr);
});
test('a public peer cannot be acknowledged into a secure default tunnel',()=>{
 assert.match(errors(validateTunnel({...tunnel(),hostVpnIPv4:'203.0.113.9'})),/SSH_PEER_NOT_PRIVATE_OR_VPN/);
});
test('SSH forwarding only local five EveJS ports is mandatory',()=>{
 const c=tunnel();c.forwardings.push({localHost:'127.0.0.1',localPort:40110,remoteHost:'127.0.0.1',remotePort:40110});
 assert.match(errors(validateTunnel(c)),/SSH_FORWARD_PORT_SET_MISMATCH/);
});
test('a reverse/wildcard SSH tunnel or disabled host-key checking is denied',()=>{
 const c=tunnel();c.forwardings[0].localHost='0.0.0.0';c.hostKeyChecking='accept-new';
 assert.match(errors(validateTunnel(c)),/INSECURE_SSH_OPTIONS/);
 assert.match(errors(validateTunnel(c)),/SSH_FORWARD_NOT_LOOPBACK_SYMMETRIC/);
});
test('same destination target port is required for localhost advertisement',()=>{
 const c=tunnel();c.forwardings[0].remotePort=40110;
 assert.match(errors(validateTunnel(c)),/SSH_FORWARD_NOT_LOOPBACK_SYMMETRIC/);
});
test('valid TCP+localhost tunnel still never implies gameplay proof',()=>{
 const result=assess({compose:compose(),nativeConfig:config(),tunnel:tunnel()});
 assert.equal(result.ok,true);assert.equal(Object.hasOwn(result,'twoClientGameplayPassed'),false);
});
