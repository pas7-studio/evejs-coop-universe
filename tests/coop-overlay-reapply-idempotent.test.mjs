// Regression: re-running the overlay installer on an ALREADY patched checkout
// must be a no-op. It used to throw "Unexpected EveJS NPC haul arrival
// location", because the station-arrival layer rewrites the haulereturn block
// that an earlier anchor in the same file looks for. CoopStart re-installs the
// overlay on every start, so that bug blocked the whole launch.
// Requires EVEJS_CODE_PATH pointing at an installed EveJS/Code checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const {specs,transform}=require('../scripts/patch-evejs-coop.cjs');
const root=process.env.EVEJS_CODE_PATH;
const installed=Boolean(root)&&existsSync(join(root,'server/src/space/coopRuntimeProbe.js'));
test('re-applying the overlay to an installed checkout changes nothing',
 {skip:installed?false:'EVEJS_CODE_PATH not set to an installed checkout'},()=>{
  const changed=[];
  for(const spec of specs){
   const file=join(root,spec.file);
   const before=readFileSync(file,'utf8');
   if(transform(before,spec,false)!==before)changed.push(spec.file);
  }
  assert.deepEqual(changed,[],'not idempotent: '+changed.join(', '));
 });
