"use strict";
// Use EveJS's authoritative static scene (same list used by npcAnchors).
// Never invent space coordinates or substitute a player's ship as a patrol POI.
const KINDS=["stargate","station","asteroidBelt","planet","moon"];
const positive=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
function validPosition(p){return !!p&&["x","y","z"].every(k=>typeof p[k]==="number"&&Number.isFinite(p[k]));}
function waypoints(scene){
 if(!Array.isArray(scene?.staticEntities))return [];
 const byID=new Map();
 for(const e of scene.staticEntities){
  const id=positive(e?.itemID);
  if(!id||!KINDS.includes(e?.kind)||!validPosition(e.position))continue;
  if(!byID.has(id))byID.set(id,{id,kind:e.kind,name:String(e.itemName||e.slimName||e.kind),position:{x:e.position.x,y:e.position.y,z:e.position.z}});
 }
 return [...byID.values()].sort((a,b)=>KINDS.indexOf(a.kind)-KINDS.indexOf(b.kind)||a.id-b.id);
}
function anchorOptions(scene){
 const entry=waypoints(scene)[0];
 if(!entry)return null;
 return {anchorDescriptor:{kind:entry.kind,itemID:entry.id},anchorName:entry.name};
}
// Use only actual EveJS scene POIs: pirates and patrols can encounter
// real Perimeter miners, while beltless Jita falls back to genuine gates.
function anchorOptionsForRole(scene,role,options={}){
 const points=waypoints(scene);
 // A pirate is never anchored on a station: a station is where its prey undocks with the station's
 // own shield and repair behind it, so a pirate parked there is a farming loop, not a world. In a
 // beltless system like Jita this used to put three pirates on top of the 4-4 undock. Meant only for
 // observation/testing, EVEJS_COOP_PIRATE_ALLOW_STATION_ANCHOR=1 brings the old behaviour back.
 const allowPirateStationAnchor=String(
  (options.env||process.env).EVEJS_COOP_PIRATE_ALLOW_STATION_ANCHOR||"")==="1";
 const hostile=String(role||"")==="pirate"&&!allowPirateStationAnchor;
 const order=role==="trader"?["station","stargate","asteroidBelt"]:
  hostile?["asteroidBelt","stargate"]:
   ["pirate","patrol","miner","hauler"].includes(role)?
    ["asteroidBelt","stargate","station"]:["stargate","station","asteroidBelt"];
 const entry=order.map(kind=>points.find(p=>p.kind===kind)).find(Boolean)||
  (hostile?null:points[0]);
 if(!entry)return null;
 // EVEJS_COOP_NPC_SPAWN_SPREAD=1: a group anchored on the same POI used to materialize inside a few
 // hundred metres of one hull, so three pirates looked like one ship. The spread is a real position
 // around the real POI, never a made-up place in space; the anchor name stays for the leash.
 const spreadMeters=Math.max(0,Number(options.spreadMeters)||0);
 if(spreadMeters>0&&validPosition(entry.position)){
  const angle=Math.random()*Math.PI*2;
  const radius=spreadMeters*(0.35+Math.random()*0.65);
  const height=(Math.random()-0.5)*spreadMeters*0.4;
  return {
   anchorName:entry.name,
   anchorDescriptor:{
    kind:"coordinates",
    position:{x:entry.position.x+Math.cos(angle)*radius,
     y:entry.position.y+Math.sin(angle)*radius,
     z:entry.position.z+height},
    direction:{x:1,y:0,z:0},
   },
  };
 }
 return {anchorDescriptor:{kind:entry.kind,itemID:entry.id},anchorName:entry.name};
}
module.exports={waypoints,anchorOptions,anchorOptionsForRole,validPosition};
