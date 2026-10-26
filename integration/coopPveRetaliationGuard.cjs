"use strict";
// Pure PvE response authorization; native EveJS owns ships, damage and orders.
// This never initiates PvP: a real, recent attack on a physical NPC must exist.
const id=value=>Number.isSafeInteger(value)&&value>0?value:null;
const position=p=>p&&["x","y","z"].every(k=>Number.isFinite(p[k]));
const range=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
function authorize({systemID,scene,victim,helper,attacker,session,
 verifiedCharacterID,aggression,now,maxRangeMeters=250000}={}){
 const system=id(systemID),character=id(verifiedCharacterID);
 if(!system||!character||!Number.isSafeInteger(now)||now<=0||
    !Number.isFinite(maxRangeMeters)||maxRangeMeters<1000||maxRangeMeters>300000||
    Number(scene?.systemID)!==system||typeof scene?.getEntityByID!=="function"||
    typeof scene?.sessions?.values!=="function")return false;
 const victimID=id(victim?.itemID),helperID=id(helper?.itemID),attackerID=id(attacker?.itemID);
 if(!victimID||!helperID||!attackerID||new Set([victimID,helperID,attackerID]).size!==3||
    victim.kind!=="ship"||victim.nativeNpc!==true||victim.session?.characterID||
    helper.kind!=="ship"||helper.nativeNpc!==true||helper.session?.characterID||
    attacker.kind!=="ship"||attacker.nativeNpc===true||
    scene.getEntityByID(victimID)!==victim||
    scene.getEntityByID(helperID)!==helper||scene.getEntityByID(attackerID)!==attacker||
    !position(victim.position)||!position(helper.position)||!position(attacker.position)||
    range(victim.position,attacker.position)>maxRangeMeters)return false;
 if(id(aggression?.lastAggressorID)!==attackerID||
    !Number.isSafeInteger(aggression?.lastAggressedAtMs)||
    aggression.lastAggressedAtMs>now||
    now-aggression.lastAggressedAtMs>120000)return false;
 if(!session||id(session.characterID)!==character||
    id(session?._space?.shipID)!==attackerID||
    id(session?._space?.systemID)!==system||
    session._space.initialStateSent!==true||
    !session.socket||session.socket.destroyed===true)return false;
 const live=[...scene.sessions.values()].filter(s=>s?.socket&&
    s.socket.destroyed!==true&&s?._space?.initialStateSent===true);
 return live.includes(session)&&
    live.filter(s=>id(s.characterID)===character).length===1&&
    live.filter(s=>id(s?._space?.shipID)===attackerID).length===1;
}
module.exports={authorize};
