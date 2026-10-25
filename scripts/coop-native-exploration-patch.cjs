"use strict";
// Reversible, strictly anchored patch for EXACT pinned EveJS exploration
// scanMgr and beyonce. No alternate scanner/warp/ownership implementation.
function patchOnce(text,oldSource,newSource,remove,file){
 const hasNew=text.includes(newSource);
 if(hasNew){
  if(text.split(newSource).length!==2)
   throw Error("DUPLICATE_NATIVE_EXPLORATION_PATCH "+file);
  return remove?text.replace(newSource,oldSource):text;
 }
 if(text.split(oldSource).length!==2)
  throw Error("UNKNOWN_PINNED_EXPLORATION_SOURCE "+file);
 return remove?text:text.replace(oldSource,newSource);
}
function patch(source,file,remove=false){
 let text=String(source);
 const eol=text.includes("\r\n")?"\r\n":"\n";
 const join=lines=>lines.join(eol);
 if(file==="server/src/services/exploration/scanMgrService.js"){
  const stopOld=join([
   '  session.sendNotification("OnSystemScanStopped", "solarsystemid2", [',
   '    Array.isArray(scanResult.probeIDs) ? scanResult.probeIDs : [],',
   '    Array.isArray(scanResult.results) ? scanResult.results : [],',
   '    Array.isArray(scanResult.absentTargets) ? scanResult.absentTargets : [],',
   '  ]);'
  ]);
  const stopNew=join([
   stopOld.replaceAll(eol,"\n"),
   '  // Only the genuine completed RequestScans callback can write proof.',
   '  if (process.env.EVEJS_COOP_EXPEDITION_SCAN_PROOF === "1" &&',
   '      scanResult._coopNativeProbeOrigin) {',
   '    try {',
   '      require("../../space/coopNativeScanProof").record({',
   '        session,scanResult,origin:scanResult._coopNativeProbeOrigin,',
   '        sites:signatureRuntime.listSystemSignatureSites(',
   '          scanResult._coopNativeProbeOrigin.systemID),',
   '      });',
   '    } catch (error) { console.warn("[CoopScanProof]",error.message); }',
   '  }'
  ]);
  text=patchOnce(text,stopOld,stopNew,remove,file+":completed");
  const startOld=join([
   '      emitProbeScanLifecycleNotifications(session, scanResult, {',
   '        startedAtFileTime: currentFileTime(),',
   '        durationMs: scanResult.durationMs,',
   '        immediateStop: resolvedDurationMs <= 1,'
  ]);
  const startNew=join([
   '      // Origin is marked on the internal server scan object, never on RPC args.',
   '      if (process.env.EVEJS_COOP_EXPEDITION_SCAN_PROOF === "1")',
   '        Object.defineProperty(scanResult,"_coopNativeProbeOrigin",{',
   '          value:{characterID,systemID,shipID:getSessionShipID(session)},enumerable:false,configurable:false',
   '        });',
   startOld.replaceAll(eol,"\n")
  ]);
  text=patchOnce(text,startOld,startNew,remove,file+":native-request");
 }else if(file==="server/src/services/ship/beyonceService.js"){
  const scanOld='    const resultID = normalizeNumber(args && args[3], 0);';
  const scanNew=join([
   '    const rawScanResultID = args && args[3];',
   '    const resultID = process.env.EVEJS_COOP_EXPEDITION_SCAN_PROOF === "1"',
   '      ? (require("../../space/coopNativeScanProof").authorize({',
   '          session,locationID,resultID:rawScanResultID,',
   '          // Do not enumerate arbitrary systems from an untrusted client ID.',
   '          sites:locationID === normalizeNumber(session && session._space && session._space.systemID,0)',
   '            ? signatureRuntime.listSystemSignatureSites(locationID) : [],',
   '        }).siteID || 0)',
   '      : normalizeNumber(rawScanResultID, 0);'
  ]);
  text=patchOnce(text,scanOld,scanNew,remove,file+":bookmark-authorize");
  const delayOld='  if (isBookmarkDelayed(bookmark, charID)) {';
  const delayNew=join([
   '  if (isBookmarkDelayed(bookmark, charID) && !(',
   '    process.env.EVEJS_COOP_EXPEDITION_FLEET_BOOKMARKS === "1" &&',
   '    require("../../space/coopNativeScanProof").fastFleetBookmarkAccess({',
   '      session,bookmarkView:runtimeBookmark,fleetRuntime',
   '    })',
   '  )) {'
  ]);
  text=patchOnce(text,delayOld,delayNew,remove,file+":fleet-delay");
 }else throw Error("UNSUPPORTED_EXPLORATION_PATCH_FILE "+file);
 return text;
}
module.exports={patch};
