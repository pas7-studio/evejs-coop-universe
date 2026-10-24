// Read-only diagnostics for EveJS SolarSystemScene: no mutations, network or client.
function id(v) { if(v===null||v===undefined||v==='')return null; const n=Number(v); return Number.isSafeInteger(n)&&n>0?n:null; }
function live(s) { return Boolean(s?.socket && s.socket.destroyed!==true && s.socket.writableEnded!==true); }
export function auditCoopScene(scene,{minimumPilots=2,registryLookup=null}={}) {
  if(!Number.isInteger(minimumPilots)||minimumPilots<1||minimumPilots>64)throw new RangeError('minimumPilots must be 1..64');
  if(!(scene?.sessions instanceof Map)||!(scene?.dynamicEntities instanceof Map))throw new TypeError('Scene must have sessions and dynamicEntities Maps');
  const findings=[],pilots=[],seenClients=new Set(),seenCharacters=new Set(),seenShips=new Set();
  const add=(code,detail,level='ERROR')=>findings.push({code,level,...detail});
  for(const s of scene.sessions.values()){
    if(!live(s)){add('STALE_SESSION',{clientID:id(s?.clientID)});continue;}
    const clientID=id(s.clientID), characterID=id(s.characterID??s.charID),shipID=id(s._space?.shipID);
    if(!clientID||!characterID||!shipID){add('MISSING_IDENTITY',{clientID,characterID,shipID});continue;}
    if(seenClients.has(clientID))add('DUPLICATE_CLIENT',{clientID});
    if(seenCharacters.has(characterID))add('DUPLICATE_CHARACTER',{characterID});
    if(seenShips.has(shipID))add('DUPLICATE_SHIP',{shipID});
    seenClients.add(clientID);seenCharacters.add(characterID);seenShips.add(shipID);
    const ship=scene.dynamicEntities.get(shipID)??scene.dynamicEntities.get(String(shipID));
    if(!ship||ship.kind!=='ship')add('MISSING_SHIP',{characterID,shipID});
    if(ship&&id(ship.itemID)!==shipID)add('SHIP_ID_MISMATCH',{characterID,shipID});
    if(typeof registryLookup==='function'&&registryLookup(characterID)!==s)add('REGISTRY_MISMATCH',{characterID,clientID});
    pilots.push({clientID,characterID,shipID,ready:s._space?.initialStateSent===true,session:s});
  }
  if(pilots.length<minimumPilots)add('INSUFFICIENT_PILOTS',{actual:pilots.length,required:minimumPilots});
  const visibility=[];
  for(let i=0;i<pilots.length;i++)for(let j=i+1;j<pilots.length;j++){
    const a=pilots[i],b=pilots[j];
    const aSeesB=a.session._space?.visibleDynamicEntityIDs instanceof Set&&a.session._space.visibleDynamicEntityIDs.has(b.shipID);
    const bSeesA=b.session._space?.visibleDynamicEntityIDs instanceof Set&&b.session._space.visibleDynamicEntityIDs.has(a.shipID);
    const entry={aCharacterID:a.characterID,bCharacterID:b.characterID,aSeesB,bSeesA};
    visibility.push(entry);
    if(a.ready&&b.ready&&aSeesB!==bSeesA)add('ASYMMETRIC_VISIBILITY',entry,'WARNING');
  }
  return {status:findings.some(x=>x.level==='ERROR')?'FAIL':'PASS',
    scope:'SERVER_SCENE_SNAPSHOT_ONLY',systemID:id(scene.systemID),
    livePilotCount:pilots.length,pilots:pilots.map(({session,...data})=>data),visibility,findings};
}
