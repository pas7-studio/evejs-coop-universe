"use strict";
const FILE="server/src/services/map/insurgencySolarsystemService.js";
const OPEN="  Handle_GetAllVisibleCampaigns(args, session) {";
const END="  Handle_GetLocalCampaignClientSnapshot(args, session) {";
const ANCHOR="    return buildList(VISIBLE_CAMPAIGN_SNAPSHOTS.map(buildCampaignSnapshot));";
const HOOK='    if (process.env.EVEJS_COOP_FW_AUTHENTIC_CAMPAIGNS_ONLY === "1") return buildList(require("../../space/coopFwInsurgencyVisibility").getAuthoritativeVisibleCampaigns());';
const count=(s,n)=>s.split(n).length-1;
function patchFwInsurgency(source,file,{remove=false}={}) {
 if(file!==FILE || typeof source!=="string")throw Error("FW_INSURGENCY_PINNED_FILE_UNSUPPORTED");
 if(count(source,OPEN)!==1 || count(source,END)!==1)throw Error("FW_INSURGENCY_PINNED_METHOD_MISMATCH");
 const start=source.indexOf(OPEN),end=source.indexOf(END,start+OPEN.length);
 if(end<=start)throw Error("FW_INSURGENCY_PINNED_ORDER_MISMATCH");
 const scope=source.slice(start,end);
 if(count(scope,ANCHOR)!==1 || count(scope,HOOK)>1 ||
    (scope.includes("EVEJS_COOP_FW_AUTHENTIC_CAMPAIGNS_ONLY") && !scope.includes(HOOK)))
   throw Error("FW_INSURGENCY_PINNED_ANCHOR_MISMATCH");
 const eol=source.includes("\r\n")?"\r\n":"\n";
 const insertion=HOOK+eol;
 if(scope.includes(HOOK) && !scope.includes(insertion)) throw Error("FW_INSURGENCY_PINNED_EOL_MISMATCH");
 const next=remove?(scope.includes(insertion)?scope.replace(insertion,""):scope):
   (scope.includes(insertion)?scope:scope.replace(ANCHOR,insertion+ANCHOR));
 return source.slice(0,start)+next+source.slice(end);
}
module.exports={patchFwInsurgency,FILE,OPEN,ANCHOR,HOOK};
