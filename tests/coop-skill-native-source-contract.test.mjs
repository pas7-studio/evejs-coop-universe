import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=process.env.EVEJS_COOP_CODE_PATH;
const read=(file)=>fs.readFileSync(path.join(root,'server/src/services',file),'utf8');
const upstream=(t)=>{if(!root){t.skip('Requires actual pinned EveJS Code checkout: no gameplay or native runtime proof');return false;}return true;};
test('pinned skill math: one native rate for SP per minute and ETA, Omega/Alpha from account',t=>{
 if(!upstream(t))return;
 const m=read('skills/training/skillTrainingMath.js');
 assert.match(m,/getBaseSkillPointsPerMinute\(characterRecord, skillTypeID, accountID\) \*/);
 assert.match(m,/getGlobalTrainingSpeedMultiplier\(\)/);
 assert.match(m,/resolveOmegaLicenseState\(/);
 assert.match(m,/CLONE_STATE_OMEGA\s*\?\s*1\s*:\s*0\.5/);
 assert.match(m,/Math\.ceil\(\s*normalizedRank \* 250 \* 2 \*\* \(2\.5 \* \(normalizedLevel - 1\)\),\s*\)/);
 assert.match(m,/getEstimatedSkillPointsAtTime\(/);
});
test('pinned queue: offline elapsed old rate native settlement then partial rebase; prerequisites, slots',t=>{
 if(!upstream(t))return;
 const q=read('skills/training/skillQueueRuntime.js');
 for(const signature of ['function settleCharacterTraining(characterID)',
  'function rebaseActiveTrainingProgress(characterID, options = {})',
  'getEstimatedSkillPointsAtTime(', 'getRequiredSkillRequirements(',
  'getAvailableTrainingSlotCount(', 'getAllQueueStates,',
  'getNowFileTime()', 'activeStartTime', 'scheduleQueueCompletion('])
  assert.ok(q.includes(signature),signature);
 assert.match(q,/if \(skillsDirty\)\s*\{\s*persistSkillMap\(/);
 assert.match(q,/if \(queueDirty\)\s*\{\s*setCharacterQueueState\(/);
 assert.match(q,/getAlphaTrainingCapBreakdown\(/);
});
test('pinned persistence: active start, skill records and queue are separate native writes',t=>{
 if(!upstream(t))return;
 const queue=read('skills/training/skillQueueState.js');
 const skills=read('skills/skillState.js');
 assert.match(queue,/SKILL_QUEUE_TABLE = "skillQueues"/);
 assert.match(queue,/database\.write\(SKILL_QUEUE_TABLE, "\/", table\)/);
 assert.match(skills,/replaceCharacterSkillRecords\(charId, skillRecords = \[\]\)/);
 assert.match(skills,/writeSkillsTable\(skillsTable\)/);
});
test('pinned skillbooks require owned authentic items, do not fabricate skills',t=>{
 if(!upstream(t))return;
 const books=read('skills/skillbooks/skillbookRuntime.js');
 assert.match(books,/findItemById/);
 assert.match(books,/removeInventoryItem/);
 assert.match(books,/getCharacterBaseSkillMap/);
 const mgr=read('skills/skillMgrService.js');
 assert.match(mgr,/Handle_InjectSkillIntoBrain\(/);
 assert.match(mgr,/injectSkillbookItems\(/);
});
test('pinned Alpha cap and Omega account license restrictions are server authoritative',t=>{
 if(!upstream(t))return;
 const restrict=read('skills/training/skillCloneRestrictions.js');
 assert.match(restrict,/ALPHA_MAX_TRAINING_SP = 5000000/);
 assert.match(restrict,/resolveOmegaLicenseState/);
 assert.match(restrict,/getMaxTrainableLevelForClone/);
 assert.match(restrict,/getAlphaTrainingCapBreakdown/);
 const sub=read('subscription/subscriptionMgrService.js');
 assert.match(sub,/resolveOmegaLicenseState/);
});
test('pinned client ETA uses same scaled mental attributes in skillMgr and Dogma',t=>{
 if(!upstream(t))return;
 const speed=read('skills/training/skillTrainingSpeed.js');
 assert.match(speed,/MENTAL_ATTRIBUTE_IDS/);
 assert.match(speed,/attributes\[attributeID\] = value \* multiplier/);
 assert.match(read('skills/skillMgrService.js'),/applyClientTrainingSpeedScale\(/);
 assert.match(read('dogma/dogmaService.js'),/applyClientTrainingSpeedScale\(/);
});
