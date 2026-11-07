'use strict';
/**
 * PF99 ORIGINAL-EVEJS SOURCE-BOUND SESSION AUTHORITY.
 *
 * Intended original location:
 *   Code/server/src/space/coopPersonalFleetOriginalSessionWitness.js
 *
 * This module takes NO registry, session-lookup, account-verifier or docking
 * authority as caller parameters. Its require() paths bind to the original
 * source-owned singleton sessionRegistry and structureLocation modules.
 * PF95/PF96 must invoke it via the original SQLite owner's read-only witness.
 *
 * Not installed by this archive; Personal Fleet remains OFF.
 */
const registry=require('../services/chat/sessionRegistry');
const docking=require('../services/structure/structureLocation');

const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const id=x=>{
 const n=Number(x);
 return Number.isSafeInteger(n)&&n>0&&(typeof x==='number'||
  typeof x==='string'&&/^[1-9][0-9]*$/.test(x))?n:0;
};
const aliasValues=(source,keys)=>{
 const values=[];
 for(const key of keys){
  if(source[key]===undefined||source[key]===null||source[key]===0)continue;
  const n=id(source[key]);if(!n)return null;
  values.push(n);
 }
 return values;
};
const allSame=(values,expected)=>values!==null&&values.length>0&&
 values.every(value=>value===expected);
const locationFields=Object.freeze({
 station:['stationid','stationID','stationId'],
 structure:['structureid','structureID','structureId']
});
const characterLocationFields=Object.freeze({
 station:['stationID','stationid'],
 structure:['structureID','structureid']
});
function positiveAlias(source,keys){
 const values=aliasValues(source,keys);
 if(!values)return null;
 if(values.length===0)return 0;
 if(values.some(x=>x!==values[0]))return null;
 return values[0];
}
function verifyOriginalDockedPlayerSession(request,reader){
 if(process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS!=='1')
  return false;
 if(!obj(request)||!obj(request.session)||!reader||
    typeof reader.get!=='function'||typeof registry.getSessions!=='function'||
    typeof registry.findSessionByCharacterID!=='function'||
    typeof docking.getSessionStationID!=='function'||
    typeof docking.getSessionStructureID!=='function'||
    typeof docking.getDockedLocationID!=='function')
  return false;
 const characterID=id(request.characterID),session=request.session;
 if(!characterID||!obj(session.socket)||session.socket.destroyed!==false)
  return false;
 if(!allSame(aliasValues(session,['characterID','charID','charid']),characterID))
  return false;
 const accountID=id(session.userid);
 if(!accountID)return false;
 // Exact object identity is critical: a caller-supplied session-shaped POJO
 // does not become a trusted session because its properties look correct.
 const active=registry.getSessions();
 if(!Array.isArray(active))return false;
 const forCharacter=active.filter(x=>id(x?.characterID||x?.charID||x?.charid)===characterID);
 if(forCharacter.length!==1||forCharacter[0]!==session||
    registry.findSessionByCharacterID(characterID)!==session)
  return false;
 let row;
 try{row=reader.get('characters',String(characterID));}
 catch{return false;}
 if(!obj(row)||row.isDeleted===true||
    row.characterID!==undefined&&id(row.characterID)!==characterID||
    id(row.accountId)!==accountID)
  return false;
 // Authenticated, docked server session and the persisted original row must
 // refer to the same station or structure, with no conflicting aliases.
 const station=positiveAlias(session,locationFields.station),
       structure=positiveAlias(session,locationFields.structure);
 if(station===null||structure===null||Boolean(station)===Boolean(structure))
  return false;
 const stationLocation=docking.getSessionStationID(session),
       structureLocation=docking.getSessionStructureID(session),
       location=docking.getDockedLocationID(session);
 if((station||0)!==stationLocation||(structure||0)!==structureLocation||
    location!==(station||structure))
  return false;
 const rowStation=positiveAlias(row,characterLocationFields.station),
       rowStructure=positiveAlias(row,characterLocationFields.structure);
 if(rowStation===null||rowStructure===null||
    rowStation!==station||rowStructure!==structure)
  return false;
 if(request.stationID!==undefined&&id(request.stationID)!==location)
  return false;
 // An active native title must also match all existing aliases in the live
 // client session. No relogin, out-of-band boarding or split alias is allowed.
 const rowShip=positiveAlias(row,['shipID','shipid','activeShipID']);
 const sessionShip=aliasValues(session,['shipID','shipid','activeShipID']);
 if(!rowShip||!allSame(sessionShip,rowShip))
  return false;
 if(Object.prototype.hasOwnProperty.call(request,'previousShipItemID')&&
    id(request.previousShipItemID)!==rowShip)
  return false;
 return true;
}
module.exports=Object.freeze({
 verifyOriginalDockedPlayerSession,
 verifyOriginalSessionLease:verifyOriginalDockedPlayerSession
});
