import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {adjust}=require("../integration/coopIndustryPacing.cjs");
const {specs,transform}=require("../scripts/patch-evejs-coop.cjs");
const codePath=process.env.EVEJS_COOP_CODE_PATH;
test("manufacturing time is 35% while research/copying and materials remain native",()=>{
 assert.equal(adjust(3600,1,1,"0.35"),1260);
 assert.equal(adjust(3600,2,1,"0.35"),3600);
 assert.equal(adjust(3600,1,1,""),3600);
 assert.equal(adjust(3600,1,1,undefined),3600);
 assert.equal(adjust(3600,1,1,"1"),3600);
 assert.throws(()=>adjust(3600,1,1,"0"),/INVALID_COOP/);
 assert.throws(()=>adjust(3600,1,1,"NaN"),/INVALID_COOP/);
 assert.throws(()=>adjust(3600,1,1,"1.5"),/INVALID_COOP/);
});
test("pinned EveJS manufacturing source overlays cleanly without material/cost changes",t=>{
 if(!codePath){t.skip("Requires pinned source: EVEJS_COOP_CODE_PATH");return;}
 const file="server/src/services/industry/industryParityHelpers.js";
 const spec=specs.find(s=>s.file===file);
 assert.ok(spec);
 const original=fs.readFileSync(path.join(codePath,file),"utf8");
 const clean=transform(original,spec,true);
 const patched=transform(clean,spec,false);
 assert.ok(original===clean||original===patched);
 assert.notEqual(patched,clean);
 assert.equal(transform(patched,spec,false),patched);
 assert.equal(transform(patched,spec,true),clean);
 new vm.Script(patched);
 assert.match(patched,/coopIndustryPacing/);
 assert.match(patched,/resolveRequiredSkillTimeModifier/);
 assert.match(patched,/resolveFacilityTimeModifier/);
});
test("native config has one real authoritative 6x skill-training and Omega source",t=>{
 if(!codePath){t.skip("Requires pinned source: EVEJS_COOP_CODE_PATH");return;}
 const config=fs.readFileSync(path.join(codePath,"server/src/config/index.js"),"utf8");
 const skills=fs.readFileSync(path.join(codePath,"server/src/services/skills/training/skillTrainingMath.js"),"utf8");
 const omega=fs.readFileSync(path.join(codePath,"server/src/services/newEdenStore/storeState.js"),"utf8");
 const subscription=fs.readFileSync(path.join(codePath,"server/src/services/subscription/subscriptionMgrService.js"),"utf8");
 assert.match(config,/envVar:\s*"EVEJS_SKILL_TRAINING_SPEED"/);
 assert.match(config,/envVar:\s*"EVEJS_OMEGA_LICENSE"/);
 assert.match(skills,/getGlobalTrainingSpeedMultiplier\(\)/);
 assert.match(skills,/resolveOmegaLicenseState\(/);
 assert.match(omega,/function resolveOmegaLicenseState\(/);
 assert.match(subscription,/resolveOmegaLicenseState\(/);
});
test("only LivingCoop deployment activates 6x Omega and bounded native manufacturing",()=>{
 const deploy=fs.readFileSync(new URL("../scripts/Deploy-Coop-RuntimeProbe.ps1",import.meta.url),"utf8");
 const start=deploy.indexOf("if ($LivingCoop) {",deploy.indexOf("EVEJS_COOP_VIRTUAL_ECONOMY"));
 const config=deploy.slice(start,deploy.indexOf("if ($LivingCoop)",start+1)>0?
  deploy.indexOf("if ($LivingCoop)",start+1):undefined);
 assert.match(config,/EVEJS_SKILL_TRAINING_SPEED: '6'/);
 assert.match(config,/EVEJS_OMEGA_LICENSE: 'true'/);
 assert.match(config,/EVEJS_COOP_MANUFACTURING_TIME_MULTIPLIER: '0.35'/);
 assert.match(config,/EVEJS_COOP_FLEET_MISSION_SHARE: '1'/);
});
