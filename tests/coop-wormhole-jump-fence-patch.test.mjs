import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {patch,fileName,hookBegin,hookComplete}=require('../scripts/coop-wormhole-jump-fence-patch.cjs');
const fixture=(eol='\n')=>[
 'function completeWormholeJump({',
 '  session,sourceScene,sourceEndpointID,shipMass,prepareResult,',
 '}) {',
 '  if (!session || !prepareResult || !prepareResult.data) return;',
 '  const pendingJump = session._wormholeJumpPending;',
 '}',
 'class WormholeMgrService extends BaseService {',
 '  Handle_WormholeJump(args, session) {',
 '    const endpointID = toInt(args && args[0], 0);',
 '  }',
 '}',
 ''].join(eol);
for(const eol of ['\n','\r\n'])test(`idempotent source hook, reversible ${eol==='\n'?'LF':'CRLF'}`,()=>{
 const source=fixture(eol);
 const installed=patch(source,fileName);
 assert.equal(installed.split(hookComplete).length-1,1);
 assert.equal(installed.split(hookBegin).length-1,1);
 assert.equal(patch(installed,fileName),installed);
 assert.equal(patch(installed,fileName,true),source);
 assert.equal(patch(source,fileName,true),source);
});
test('wrong pathname is not transformed',()=>{
 const source=fixture();assert.equal(patch(source,'server/src/space/transitions.js'),source);
});
test('drift and duplicated anchor fail closed',()=>{
 assert.throws(()=>patch(fixture().replace('session._wormholeJumpPending','session.bad'),fileName),/ANCHOR_DRIFT/);
 assert.throws(()=>patch(fixture()+'  const pendingJump = session._wormholeJumpPending;\n',fileName),/ANCHOR_DRIFT/);
});
test('non-source hook spoofing is never silently accepted',()=>{
 assert.throws(()=>patch(fixture()+'//'+hookComplete,fileName),/HOOK_DRIFT/);
});
