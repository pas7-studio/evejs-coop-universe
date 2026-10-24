import test from 'node:test';
import assert from 'node:assert/strict';
import {auditCoopLifecycle} from '../scripts/coop-lifecycle-audit.mjs';
const pilot=(clientID,characterID,shipID,other)=>({clientID,characterID,socket:{destroyed:false},_space:{shipID,initialStateSent:true,visibleDynamicEntityIDs:new Set([other])}});
const scene=(...pilots)=>({systemID:30000142,sessions:new Map(pilots.map(p=>[p.clientID,p])),dynamicEntities:new Map([[8001,{itemID:8001,kind:'ship'}],[8002,{itemID:8002,kind:'ship'}]])});
function fixture(){const a=pilot(1,101,8001,8002),b=pilot(2,102,8002,8001),nextA=pilot(3,101,8001,8002);return {before:scene(a,b),disconnected:scene(b),reconnected:scene(nextA,b)};}
test('A rejoins with new session while B remains unaffected',()=>assert.equal(auditCoopLifecycle(fixture()).status,'PASS'));
test('lost survivor fails',()=>{const f=fixture();f.disconnected=scene();assert.ok(auditCoopLifecycle(f).findings.some(x=>x.code==='DISCONNECT_PILOT_COUNT'));});
test('reusing stale A session fails',()=>{const f=fixture();f.reconnected=f.before;assert.ok(auditCoopLifecycle(f).findings.some(x=>x.code==='STALE_SESSION_REUSED'));});
test('returning with wrong ship fails',()=>{const f=fixture();f.reconnected.sessions.get(3)._space.shipID=8002;assert.ok(auditCoopLifecycle(f).findings.some(x=>x.code==='SHIP_OWNERSHIP_CHANGED'));});
test('replacing B session fails',()=>{const f=fixture();f.reconnected=scene(f.reconnected.sessions.get(3),pilot(5,102,8002,8001));assert.ok(auditCoopLifecycle(f).findings.some(x=>x.code==='SURVIVOR_SESSION_REPLACED'));});
test('changing scene system fails',()=>{const f=fixture();f.reconnected.systemID=30000144;assert.ok(auditCoopLifecycle(f).findings.some(x=>x.code==='SYSTEM_CHANGED'));});
