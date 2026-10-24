// Pure lifecycle guard for scene membership. Useful for testing the invariants
// without pretending a synthetic client has negotiated the EVE protocol.
const id=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):null;
export function reconnectPilot(scene,registry,oldSession,newSession) {
  if(!(scene?.sessions instanceof Map)||!registry||typeof registry.register!=='function'||typeof registry.unregister!=='function')throw Error('Invalid scene or registry');
  const char=id(newSession?.characterID??newSession?.charID);
  const ship=id(newSession?._space?.shipID);
  const client=id(newSession?.clientID);
  if(!char||!ship||!client||newSession?.socket?.destroyed!==false)throw Error('Invalid replacement session');
  if(!scene.dynamicEntities?.has(ship))throw Error('Replacement ship not present in scene');
  if(oldSession){
    if(id(oldSession.characterID??oldSession.charID)!==char||id(oldSession._space?.shipID)!==ship)throw Error('Reconnect identity mismatch');
  }
  for(const s of scene.sessions.values()){
    if(s===oldSession)continue;
    if(id(s.clientID)===client||id(s.characterID??s.charID)===char||id(s._space?.shipID)===ship)throw Error('Duplicate active ownership');
  }
  if(oldSession){
    for(const [key,s] of scene.sessions){if(s===oldSession)scene.sessions.delete(key);}
    registry.unregister(oldSession);
  }
  scene.sessions.set(newSession.clientID,newSession);
  registry.register(newSession);
  return {characterID:char,shipID:ship,clientID:client};
}
