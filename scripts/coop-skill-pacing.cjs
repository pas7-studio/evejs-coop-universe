"use strict";
// Read-only representative skill duration calculator for the pinned EveJS formula.
// This does not grant SP, touch player records, or replace native training math.
const SPEEDS=Object.freeze([6,12,24,48]);
const MAX_LEVEL=5;
function positive(value,name){if(!Number.isFinite(value)||value<=0)throw Error("INVALID_"+name);return value;}
function points(rank,level){
 positive(rank,"SKILL_RANK");
 if(!Number.isInteger(level)||level<0||level>MAX_LEVEL)throw Error("INVALID_SKILL_LEVEL");
 if(level===0)return 0;
 return Math.ceil(rank*250*2**(2.5*(level-1)));
}
function durationHours({rank,fromLevel=4,toLevel=5,primary=20,secondary=20,speed=48,omega=true}={}){
 if(!SPEEDS.includes(speed))throw Error("INVALID_TRAINING_SPEED");
 if(!Number.isInteger(fromLevel)||!Number.isInteger(toLevel)||fromLevel<0||toLevel>MAX_LEVEL||fromLevel>=toLevel)throw Error("INVALID_SKILL_RANGE");
 const perMinute=(positive(primary,"PRIMARY_ATTRIBUTE")+positive(secondary,"SECONDARY_ATTRIBUTE")/2)*
  (omega?1:0.5)*speed;
 return (points(rank,toLevel)-points(rank,fromLevel))/perMinute/60;
}
function report({speed=48,primary=20,secondary=20,omega=true}={}){
 return [1,2,4,8,16].map(rank=>({
  rank,fromLevel:4,toLevel:5,
  remainingSP:points(rank,5)-points(rank,4),
  durationHours:Number(durationHours({rank,fromLevel:4,toLevel:5,primary,secondary,speed,omega}).toFixed(2))
 }));
}
if(require.main===module){
 const speed=Number(process.argv[2]||48);
 process.stdout.write(JSON.stringify({nativeModel:"EVEJS_SKILL_TRAINING_SPEED",speed,
  baseAttributes:"20 primary + 20 secondary",omega:true,
  examples:report({speed}),notPlayerQueue:true},null,2)+"\n");
}
module.exports={SPEEDS,points,durationHours,report};
