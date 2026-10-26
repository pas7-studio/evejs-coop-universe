import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {SPEEDS,points,durationHours,report}=require("../scripts/coop-skill-pacing.cjs");
const root=path.resolve(import.meta.dirname,"..");
test("local co-op V2 uses exact pinned native EveJS SP threshold formula",()=>{
 assert.equal(points(1,1),250);
 assert.equal(points(1,5),256000);
 assert.equal(points(4,5)-points(4,4),842980);
 assert.equal(points(4,0),0);
 assert.throws(()=>points(4,6),/INVALID_SKILL_LEVEL/);
 assert.throws(()=>points(0,5),/INVALID_SKILL_RANK/);
});
test("48x Omega starter rank 4 IV->V completes within 6-12h without raw SP grants",()=>{
 const h=durationHours({rank:4,speed:48,primary:20,secondary:20,omega:true});
 assert.ok(h>=6&&h<=12,h);
 assert.equal(Number(h.toFixed(2)),9.76);
 assert.ok(durationHours({rank:4,speed:6})>78);
 assert.ok(durationHours({rank:8,speed:48})>durationHours({rank:4,speed:48}));
 assert.ok(durationHours({rank:16,speed:48})>24);
 assert.equal(Number((durationHours({rank:4,speed:48,omega:false})/h).toFixed(6)),2);
});
test("progression profile requires a recognized positive rate and realistic attributes",()=>{
 assert.deepEqual(SPEEDS,[6,12,24,48]);
 for(const speed of SPEEDS)assert.equal(report({speed}).length,5);
 for(const speed of [0,-1,7,100,NaN,Infinity])
  assert.throws(()=>durationHours({rank:1,speed}),/INVALID_TRAINING_SPEED/);
 assert.throws(()=>durationHours({rank:4,fromLevel:5,toLevel:4}),/INVALID_SKILL_RANGE/);
 assert.throws(()=>durationHours({rank:4,primary:0}),/INVALID_PRIMARY_ATTRIBUTE/);
});
test("LivingCoop currently defaults to 100x, supports explicit 48x, and refuses silent rate migrations",()=>{
 const deploy=fs.readFileSync(path.join(root,"scripts/Deploy-Coop-RuntimeProbe.ps1"),"utf8");
 assert.match(deploy,/\[ValidateSet\(6,12,24,48,100\)\]\[int\]\$CoopSkillTrainingSpeed = 100/);
 assert.match(deploy,/EVEJS_SKILL_TRAINING_SPEED: '\$CoopSkillTrainingSpeed'/);
 assert.match(deploy,/\$priorSpeed -ne \$CoopSkillTrainingSpeed -and -not \$ConfirmActiveTrainingRebased/);
 assert.match(deploy,/Training rate .* BLOCKED/);
 assert.match(deploy,/EVEJS_OMEGA_LICENSE: 'true'/);
 assert.doesNotMatch(deploy,/EVEJS_SKILL_TRAINING_SPEED: '6'/);
});
test("diagnostics inspect only running flags, never alter persistent state",()=>{
 const script=fs.readFileSync(path.join(root,"scripts/Inspect-Coop-Training.ps1"),"utf8");
 assert.match(script,/docker inspect --format/);
 assert.match(script,/EVEJS_SKILL_TRAINING_SPEED\|EVEJS_OMEGA_LICENSE/);
 assert.match(script,/QUEUES_NOT_INSPECTED/);
 assert.doesNotMatch(script,/docker compose .*\b(up|down|build|restart)\b|Set-Content|Remove-Item|docker volume rm/);
});
test("pinned native queue uses same global training multiplier for SP per minute and ETA",t=>{
 const code=process.env.EVEJS_COOP_CODE_PATH;
 if(!code)return t.skip("Requires pinned EveJS source checkout");
 const math=fs.readFileSync(path.join(code,"server/src/services/skills/training/skillTrainingMath.js"),"utf8");
 const queue=fs.readFileSync(path.join(code,"server/src/services/skills/training/skillQueueRuntime.js"),"utf8");
 assert.match(math,/normalizedRank \* 250 \* 2 \*\* \(2\.5 \* \(normalizedLevel - 1\)\)/);
 assert.match(math,/getBaseSkillPointsPerMinute\(characterRecord, skillTypeID, accountID\) \*/);
 assert.match(math,/getGlobalTrainingSpeedMultiplier\(\)/);
 assert.match(queue,/getTrainingDurationFiletimeTicks\(/);
 assert.match(queue,/getEstimatedSkillPointsAtTime\(/);
 assert.match(queue,/getGlobalTrainingSpeedMultiplier\(\)/);
});
