'use strict';
/** Explicit native bootstrap boundary. No global auto-discovery, no env-only
 * trust. The boot owner supplies original PF58 SQLite verifier and reciprocal
 * real writer fence. A partial install or conflicting reinstall fails closed.
 */
let installed=null;
function install({permitVerifier,allWritersFenced,featureEnabled}={}){
 if(installed!==null)throw Error('PF58_NATIVE_BINDINGS_ALREADY_INSTALLED');
 if(typeof permitVerifier?.verify!=='function'||
    typeof allWritersFenced!=='function'||typeof featureEnabled!=='function')
  throw Error('PF58_NATIVE_BINDINGS_AUTHORITIES_REQUIRED');
 installed=Object.freeze({permitVerifier,allWritersFenced,featureEnabled});
 return true;
}
function authorize(entityRecord,{allowIssuing=false}={}){
 if(!installed)return false;
 try{return installed.featureEnabled()===true&&
    installed.allWritersFenced()===true&&
    installed.permitVerifier.verify({entityRecord,allowIssuing})===true;}
 catch{return false;}
}
function isInstalled(){return installed!==null;}
module.exports={install,authorize,isInstalled};
