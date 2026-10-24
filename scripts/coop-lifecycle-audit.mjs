import { auditCoopScene } from './coop-scene-audit.mjs';
// Read-only three-phase scene lifecycle invariant checker.
export function auditCoopLifecycle({before,disconnected,reconnected},{registryLookups={}}={}) {
  for(const [name,v] of Object.entries({before,disconnected,reconnected}))
    if(!v||!(v.sessions instanceof Map))throw new TypeError(name+' scene required');
  const phases={
    before:auditCoopScene(before,{minimumPilots:2,registryLookup:registryLookups.before}),
    disconnected:auditCoopScene(disconnected,{minimumPilots:1,registryLookup:registryLookups.disconnected}),
    reconnected:auditCoopScene(reconnected,{minimumPilots:2,registryLookup:registryLookups.reconnected})
  };
  const findings=[],fail=(code,details={})=>findings.push({code,...details});
  const original=phases.before.pilots,remaining=phases.disconnected.pilots,returned=phases.reconnected.pilots;
  if(original.length!==2)fail('INITIAL_PILOT_COUNT',{actual:original.length});
  if(remaining.length!==1)fail('DISCONNECT_PILOT_COUNT',{actual:remaining.length});
  if(returned.length!==2)fail('RECONNECT_PILOT_COUNT',{actual:returned.length});
  if(original.length===2&&remaining.length===1){
    const survivor=remaining[0],priorSurvivor=original.find(p=>p.characterID===survivor.characterID);
    if(!priorSurvivor||priorSurvivor.clientID!==survivor.clientID||priorSurvivor.shipID!==survivor.shipID)
      fail('SURVIVOR_CHANGED',{characterID:survivor.characterID});
    for(const old of original){
      const current=returned.find(p=>p.characterID===old.characterID);
      if(!current){fail('CHARACTER_NOT_RESTORED',{characterID:old.characterID});continue;}
      if(current.shipID!==old.shipID)fail('SHIP_OWNERSHIP_CHANGED',{characterID:old.characterID});
      if(old.characterID===survivor.characterID&&current.clientID!==old.clientID)
        fail('SURVIVOR_SESSION_REPLACED',{characterID:old.characterID});
      if(old.characterID!==survivor.characterID&&current.clientID===old.clientID)
        fail('STALE_SESSION_REUSED',{characterID:old.characterID});
    }
  }
  for(const [phase,data] of Object.entries(phases))
    if(data.status!=='PASS')fail('SCENE_AUDIT_FAILED',{phase,findings:data.findings});
  const systems=[before.systemID,disconnected.systemID,reconnected.systemID].map(Number);
  if(!systems.every(x=>x===systems[0]))fail('SYSTEM_CHANGED',{systems});
  return {status:findings.length?'FAIL':'PASS',scope:'IN_MEMORY_SCENE_LIFECYCLE_ONLY',phases,findings};
}
