import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {patch,ACTION_HOOK,BRIEF_HOOK}=require('../scripts/coop-faction-war-agent-patch.cjs');
const {patch:jobPatch}=require('../scripts/coop-native-job-agent-patch.cjs');
const source='  const actionID = args && args.length > 0 ? args[0] : null;\n'+
 '  Handle_GetMissionBriefingInfo(args, session) {\n';
test('reversible/idempotent pinned hook takes precedence over corporate convoy',()=>{
 const job=jobPatch(source),installed=patch(job);
 assert.equal(installed.indexOf(ACTION_HOOK)<installed.indexOf('coopNativeJobAgent'),true);
 assert.equal(installed.indexOf(BRIEF_HOOK)<installed.lastIndexOf('coopNativeJobAgent'),true);
 assert.equal(patch(installed),installed);
 assert.equal(jobPatch(patch(installed,{remove:true}),{remove:true}),source);
});
test('CRLF pinned overlay reversible and missing anchor fails closed',()=>{
 const crlf=source.replaceAll('\n','\r\n');
 assert.equal(patch(patch(crlf),{remove:true}),crlf);
 assert.throws(()=>patch('broken'),/FW_AGENT_PINNED_ANCHOR_MISMATCH/);
});
