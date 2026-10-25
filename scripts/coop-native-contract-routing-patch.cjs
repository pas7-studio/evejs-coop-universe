"use strict";
// Reversible source adaptation for pinned EveJS native contracts.
// Never copy escrow, ISK or items into a parallel co-op state store.
// Opt-in by EVEJS_COOP_NATIVE_CONTRACTS=1 (NOT auto-enabled at deploy).
const count=(text,fragment)=>text.split(fragment).length-1;
function exact(text,before,after,remove,file){
  const hasAfter=text.includes(after);
  if(hasAfter){
    if(count(text,after)!==1)throw Error("DUPLICATE_COOP_CONTRACT_PATCH "+file);
    return remove?text.replace(after,before):text;
  }
  if(count(text,before)!==1)throw Error("UNKNOWN_PINNED_CONTRACT_SOURCE "+file);
  return remove?text:text.replace(before,after);
}
const aliasAnchor='log.success(`registered ${serviceManager.count} services`);';
const aliasBlock=[
 'if (process.env.EVEJS_COOP_NATIVE_CONTRACTS === "1") {',
 '  // The stock client calls contractMgr, but that service has no settlement',
 '  // handlers. Route the existing name to the authoritative contractProxy.',
 '  const nativeContractProxy = serviceManager.lookup("contractProxy");',
 '  if (!serviceManager.lookup("contractMgr") || !nativeContractProxy ||',
 '      typeof nativeContractProxy.Handle_CreateContract !== "function" ||',
 '      typeof nativeContractProxy.Handle_AcceptContract !== "function" ||',
 '      typeof nativeContractProxy.Handle_CompleteContract !== "function")',
 '    throw Error("COOP_NATIVE_CONTRACT_PROXY_UNAVAILABLE");',
 '  serviceManager.registerAlias("contractMgr", "contractProxy");',
 '}',
 '',
 aliasAnchor
].join("\n");
const infoAnchor='        ["contractMgr", null],';
const infoBlock=[
 infoAnchor,
 '        ...(process.env.EVEJS_COOP_NATIVE_CONTRACTS === "1"',
 '          ? [["contractProxy", null]] : []),'
].join("\n");
function courierGuard(name){
 return [
  'function '+name+'(contract, session) {',
  '  if (process.env.EVEJS_COOP_NATIVE_CONTRACTS === "1") {',
  '    // Closing or failing a courier contract transfers real cargo/ISK.',
  '    // Reject third-party requests, including unrelated fleet members.',
  '    const wallet = contract && contract.acceptorWallet;',
  '    const acceptorID = toPositiveInteger(contract && contract.acceptorID, 0);',
  '    const walletOwnerID = toPositiveInteger(wallet && wallet.ownerID, 0);',
  '    const callerID = wallet && wallet.kind === "corporation"',
  '      ? getSessionCorporationID(session) : getSessionCharacterID(session);',
  '    if (!acceptorID || !walletOwnerID || walletOwnerID !== acceptorID ||',
  '        callerID !== acceptorID)',
  '      throwContractError("Only the original courier acceptor can settle this contract.");',
  '  }'
 ].join("\n");
}
function patch(source,file,remove=false){
 let text=String(source);
 const eol=text.includes("\r\n")?"\r\n":"\n";
 const line=(v)=>v.replace(/\n/g,eol);
 if(file==="server/index.js"){
   text=exact(text,aliasAnchor,line(aliasBlock),remove,file);
 }else if(file==="server/src/services/machoNet/machoNetService.js"){
   text=exact(text,infoAnchor,line(infoBlock),remove,file);
 }else if(file==="server/src/services/contracts/contractRuntimeState.js"){
   for(const fn of ["completeCourierContract","failCourierContract"]){
     const anchor="function "+fn+"(contract, session) {";
     text=exact(text,anchor,line(courierGuard(fn)),remove,file);
   }
 }else throw Error("UNSUPPORTED_COOP_CONTRACT_PATCH_PATH "+file);
 return text;
}
module.exports={patch};
