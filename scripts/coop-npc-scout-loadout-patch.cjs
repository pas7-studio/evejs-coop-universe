"use strict";
// EX-03B4 source insertion before original hardware/fitting validation.
// Authored module and charge are allocated by original nativeNpcService.
const FILE="server/src/space/npc/nativeNpcService.js";
const anchor=`  const hardwareValidation = validateNpcHardwareDefinition(definition);
  if (!hardwareValidation.success) {
    return hardwareValidation;
  }`;
const inserted=`  // COOP_EX03B4_NATIVE_SCOUT_AUTHORING
  if (process.env.EVEJS_COOP_NPC_SCOUT_LOADOUT === "1" &&
      process.env.EVEJS_COOP_NPC_PROBE_LOADOUT_SPLIT === "1" &&
      process.env.EVEJS_COOP_NPC_PROBE_LAUNCH === "1" &&
      options.coopExpeditionScout === true &&
      options.transient === false) {
    const explorationAuthority = require(path.join(__dirname,
      "../../services/exploration/explorationAuthority"));
    const authoredScout = require(path.join(__dirname, "../coopNpcScoutLoadout"))
      .createNpcScoutLoadout({
        resolveItemByTypeID,
        compatibleCharges:typeID=>explorationAuthority
          .getCompatibleProbeChargeTypeIDs(typeID)
      }).apply(definition);
    if (!authoredScout.success) return authoredScout;
    definition = authoredScout.definition;
  }
  // COOP_EX03B4_NATIVE_SCOUT_AUTHORING_END
${anchor}`;
function patch(source,file,remove=false){
 if(file!==FILE)return source;
 const from=remove?inserted:anchor,to=remove?anchor:inserted;
 if(!remove&&source.includes(inserted))return source;
 if(remove&&!source.includes(inserted)&&source.includes(anchor))return source;
 if(source.split(from).length!==2)throw Error("NPC_SCOUT_LOADOUT_SOURCE_ANCHOR_DRIFT");
 return source.replace(from,to);
}
module.exports={patch,FILE};
