"use strict";
// Authoritative, opt-in native NPC weapon activation gate.
// It prevents a real fitted ammo-requiring gun from activating/remaining
// active without a real compatible native module-bound cargo stack.
// It NEVER consumes ammo, invents a firing event, alters damage, or grants ISK.
const store = require("./npc/nativeNpcStore");
const dogma = require("./combat/weaponDogma");
const capability = require("./npc/npcCapabilityResolver");
const positive = x => Number.isSafeInteger(Number(x)) && Number(x)>0 ? Number(x) : null;
const optional = new Set(["laserTurret"]);
const requiring = new Set(["missileLauncher","projectileTurret","hybridTurret","precursorTurret","laserTurret"]);
function check({entity,moduleItem,bankModuleIDs=[]}={}){
 const allowed=(status,details={})=>({allowed:true,status,...details});
 const refused=(status,details={})=>({allowed:false,status,...details});
 if(process.env.EVEJS_COOP_NPC_STRICT_AMMO!=="1"||
  entity?.nativeNpc!==true||entity?.kind!=="ship")
  return allowed("DEFAULT_UNMODIFIED");
 if(moduleItem?.npcSyntheticHullWeapon===true)return allowed("SYNTHETIC_HULL_WEAPON");
 const entityID=positive(entity.itemID),moduleID=positive(moduleItem?.itemID);
 if(!entityID||!moduleID)return refused("INVALID_NATIVE_WEAPON");
 try{
  const family=dogma.resolveWeaponFamily(moduleItem);
  if(!requiring.has(family))return refused("UNKNOWN_NATIVE_WEAPON_FAMILY");
  if(dogma.isChargeOptionalTurretWeapon(moduleItem)===true)
   return allowed("CHARGE_OPTIONAL_WEAPON");
  const native=store.getNativeEntity(entityID);
  if(!native||Number(native.entityID)!==entityID||
   !positive(native.ownerID)||Number(native.systemID)!==Number(entity.systemID))
   return refused("NATIVE_SHIP_CUSTODY_MISSING");
  const ownerID=Number(native.ownerID);
  const moduleRows=store.listNativeModulesForEntity(entityID);
  const cargo=store.listNativeCargoForEntity(entityID);
  if(!Array.isArray(moduleRows)||!Array.isArray(cargo))
   return refused("NATIVE_MODULE_CARGO_UNAVAILABLE");
  const grouped=Array.isArray(bankModuleIDs)&&bankModuleIDs.length>1?
   [...new Set(bankModuleIDs.map(positive))]:[moduleID];
  if(grouped.some(id=>!id)||grouped.length>16||!grouped.includes(moduleID))
   return refused("NATIVE_BANK_MEMBERSHIP_INVALID");
  for(const memberID of grouped){
   const fitted=moduleRows.filter(m=>Number(m.moduleID)===memberID&&
    Number(m.entityID)===entityID&&Number(m.ownerID)===ownerID&&
    Number(m.categoryID)===7&&positive(m.flagID)&&
    m.moduleState?.online!==false&&m.moduleState?.isOnline!==false);
   if(fitted.length!==1)return refused("NATIVE_WEAPON_MODULE_NOT_VERIFIED",{memberID});
   const charges=cargo.filter(row=>Number(row.moduleID)===memberID);
   const valid=charges.filter(row=>Number(row.entityID)===entityID&&
    Number(row.ownerID)===ownerID&&Number(row.categoryID)===8&&
    row.transient!==true&&positive(row.cargoID)&&positive(row.typeID)&&
    Number.isSafeInteger(Number(row.quantity))&&Number(row.quantity)>0&&
    capability.isNpcChargeCompatibleWithModule(fitted[0],Number(row.typeID))===true);
   if(valid.length!==1||charges.length!==1)
    return refused("NATIVE_AMMO_EMPTY_OR_AMBIGUOUS",{memberID});
  }
  return allowed("NATIVE_LOADED_AMMO_VERIFIED",{modules:grouped.length});
 }catch(_){
  return refused("NATIVE_AMMO_PROOF_UNAVAILABLE");
 }
}
module.exports={check};
