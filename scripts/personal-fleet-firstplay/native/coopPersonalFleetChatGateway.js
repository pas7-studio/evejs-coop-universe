'use strict';
/**
 * Source-bound, inert until native server owner installs an authority.
 * Intended original path: Code/server/src/space/coopPersonalFleetChatGateway.js
 * No public HTTP listener, no client-supplied IDs as authority, no mock offers.
 */
const sessionRegistry=require('../services/chat/sessionRegistry');
const gameStore=require('../gameStore');
const TOKEN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const INTEGER=/^[1-9][0-9]{0,15}$/;
const ACTIONS=Object.freeze({
  help:{arity:0,method:null},
  offers:{arity:0,method:'offers'},
  status:{arity:0,method:'status'},
  roster:{arity:0,method:'roster'},
  hire:{arity:2,method:'hire'},
  assign:{arity:2,method:'assign'},
  deploy:{arity:1,method:'deploy'},
  follow:{arity:1,method:'follow'},
  hold:{arity:1,method:'hold'},
  attack:{arity:2,method:'attack'},
  guard:{arity:1,method:'guard'},
  return:{arity:1,method:'returnToBase'},
  salary:{arity:1,method:'salary'},
  dismiss:{arity:1,method:'dismiss'},
});
const HELP='Personal Fleet: /pf offers | roster | status | hire <offerID> accept-recurring | assign <pilotID> <hangarShipItemID> | deploy <assignmentID> | follow <shipItemID> | hold <shipItemID> | attack <shipItemID> <enemyNpcEntityID> | guard <shipItemID> | return <shipItemID> | salary <pilotID> | dismiss <pilotID>';
const pos=x=>Number.isSafeInteger(x)&&x>0;
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const safeString=x=>String(x??'').replace(/[\r\n\t\u0000-\u001f\u007f]/g,' ').slice(0,250);
const denied=reason=>Object.freeze({handled:true,message:'Personal Fleet: '+safeString(reason)});
const id=x=>typeof x==='number'&&pos(x)?x:
  typeof x==='string'&&INTEGER.test(x)&&pos(Number(x))&&String(Number(x))===x?Number(x):0;
let installed=null;
function enabled(){
 return process.env.EVEJS_COOP_PERSONAL_FLEET_CHAT==='1'&&
   process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE==='1'&&
   process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS==='1';
}
function verifySession(session){
 if(!session||typeof session!=='object'||!session.socket||
    session.socket.destroyed!==false)return null;
 const characterID=id(session.characterID),accountID=id(session.userid);
 if(!characterID||!accountID||
   (session.charID!==undefined&&id(session.charID)!==characterID)||
   (session.charid!==undefined&&id(session.charid)!==characterID))return null;
 const active=sessionRegistry.getSessions();
 if(!Array.isArray(active)||
   active.filter(s=>s?.characterID===characterID).length!==1||
   active.filter(s=>s===session).length!==1||
   sessionRegistry.findSessionByCharacterID(characterID)!==session)return null;
 const atomic=gameStore.coopAtomicNativeRows;
 if(atomic?.mode!=='SERVER_INTERNAL_FLAGGED'||
    typeof atomic.transact!=='function'||atomic.isPoisoned?.()!==false)return null;
 try{
  const row=atomic.transact(['characters'],tx=>tx.get('characters',String(characterID)));
  if(!row||row.characterID!==undefined&&row.characterID!==characterID||
     id(row.accountId)!==accountID||row.isDeleted===true)return null;
  // Prevent accepted stale or foreign sessions from switching the character
  // without re-checking the same original account row.
  return Object.freeze({session,characterID,accountID});
 }catch{return null;}
}
function installServerAuthority(candidate){
 if(installed)return false;
 if(!candidate||typeof candidate!=='object'||
    candidate.source!=='ORIGINAL_EVEJS_PERSONAL_FLEET_OWNER_V1'||
    typeof candidate.enabled!=='function'||
    !Object.values(ACTIONS).every(x=>x.method===null||typeof candidate[x.method]==='function'))
  return false;
 // A native module must install this once after all PF52/53/54/55/56/57
 // constructors succeed. A flag alone never creates a fake provider.
 installed=Object.freeze({...candidate});
 return true;
}
function parseCommand(text){
 if(typeof text!=='string'||text.length>256||/[\r\n\u0000-\u001f\u007f]/.test(text))return null;
 const args=text.trim().split(/\s+/).filter(Boolean);
 const action=(args.shift()||'help').toLowerCase();
 const spec=ACTIONS[action];
 if(!spec||args.length!==spec.arity)return null;
 if(args.some(a=>!TOKEN.test(a)))return null;
 if(action==='hire'&&args[1]!=='accept-recurring')return null;
 if(action==='assign'){
  if(!/^coop-pilot-[0-9]{3,}$/.test(args[0])||!id(args[1]))return null;
  args[1]=id(args[1]);
 }else if(action==='attack'){
  if(!id(args[0])||!id(args[1])||args[0]===args[1])return null;
  args[0]=id(args[0]);args[1]=id(args[1]);
 }else if(['follow','hold','guard','return'].includes(action)){
  if(!id(args[0]))return null;args[0]=id(args[0]);
 }else if(['dismiss','salary'].includes(action)&& !/^coop-pilot-[0-9]{3,}$/.test(args[0]))return null;
 return {action,args,spec};
}
function render(result){
 if(!result||typeof result!=='object'||typeof result.status!=='string')
  return 'Native outcome unavailable; check server logs. Do not retry a mutation.';
 // Nothing from caller is interpreted as successful unless the native
 // authority says so; expose only small non-sensitive public status fields.
 const fields=['reason','operationID','assignmentID','pilotID','shipItemID','phase'];
 const parts=[safeString(result.status)];
 for(const key of fields)if(own(result,key)&&result[key]!=null&&
   (typeof result[key]==='string'||typeof result[key]==='number'))
   parts.push(key+'='+safeString(result[key]));
 if(typeof result.message==='string')parts.push(safeString(result.message));
 return parts.join(' ').slice(0,700);
}
function handleChat({session,argumentText}={}){
 if(!enabled())return denied('DISABLED');
 const command=parseCommand(argumentText);
 if(!command)return denied('INVALID_COMMAND. '+HELP);
 if(command.action==='help')return denied(HELP);
 const auth=verifySession(session);
 if(!auth)return denied('AUTHENTICATED_NATIVE_SESSION_UNVERIFIED');
 const owner=installed;
 if(!owner||owner.enabled()!==true)return denied('NATIVE_AUTHORITY_NOT_INSTALLED');
 let answer;
 try{
  answer=owner[command.spec.method]({
   session:auth.session,ownerCharacterID:auth.characterID,
   accountID:auth.accountID,args:Object.freeze(command.args.slice())
  });
  if(answer?.then||answer?.catch&&typeof answer.catch==='function')
   return denied('ASYNC_NATIVE_OUTCOME_UNKNOWN_NO_RETRY');
 }catch{return denied('NATIVE_ERROR_OUTCOME_UNKNOWN_NO_RETRY');}
 return denied(render(answer));
}
module.exports=Object.freeze({installServerAuthority,handleChat,parseCommand,HELP});
