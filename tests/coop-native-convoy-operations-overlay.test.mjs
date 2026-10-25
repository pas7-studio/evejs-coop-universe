import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const overlay=require("../scripts/patch-evejs-coop.cjs");

test("P1 incidents are copied through the normal pinned L2 installer, no new native hooks",()=>{
 const src=readFileSync(new URL("../scripts/patch-evejs-coop.cjs",import.meta.url),"utf8");
 assert.match(src,/"coopConvoyOperations"/);
 assert.ok(overlay.names.includes("coopConvoyOperations"));
 assert.ok(overlay.names.includes("coopWorldSignals"));
 assert.ok(overlay.names.includes("coopPlayerCombatWitness"));
 assert.doesNotMatch(src,/coop-convoy-operations-patch\.cjs/);
});
test("P1 two explicit operator opt-ins; vanilla and standard LivingCoop have NO new incident journal",()=>{
 const ps=readFileSync(new URL("../scripts/Deploy-Coop-RuntimeProbe.ps1",import.meta.url),"utf8");
 assert.match(ps,/\[switch\]\$EnableConvoyOperations/);
 assert.match(ps,/if \(\$EnableConvoyOperations -and -not \$LivingCoop\)/);
 const cond=ps.match(/if \(\$EnableConvoyOperations\) \{([\s\S]*?)\}/);
 assert.ok(cond);
 assert.match(cond[1],/EVEJS_COOP_CONVOY_OPERATIONS: '1'/);
 assert.match(cond[1],/EVEJS_COOP_PLAYER_DAMAGE_EVIDENCE: '1'/);
});
test("P1 incident initiation is restricted to real raid actions accepted by the native director",()=>{
 const world=readFileSync(new URL("../integration/coopWorldSignals.cjs",import.meta.url),"utf8");
 assert.match(world,/if\(process\.env\.EVEJS_COOP_CONVOY_OPERATIONS==="1"\)/);
 assert.match(world,/const valid = actions\.filter/);
 assert.ok(world.indexOf("NO_VERIFIED_NATIVE_ACTION")<world.indexOf('require("./coopConvoyOperations").noteRaid'));
});
test("P1 native applied combat evidence is source of truth, never synthetic reward authority",()=>{
 const witness=readFileSync(new URL("../integration/coopPlayerCombatWitness.cjs",import.meta.url),"utf8");
 const ledger=readFileSync(new URL("../integration/coopConvoyOperations.cjs",import.meta.url),"utf8");
 assert.match(witness,/receipt\?\.status==="APPLIED_NATIVE_PLAYER_DAMAGE"/);
 assert.match(witness,/require\("\.\/coopConvoyOperations"\)\.noteDamage/);
 assert.match(ledger,/NATIVE_KILLMAIL_TRACKER_NOTE_DAMAGE/);
 assert.match(ledger,/PIRATE_WRECK_CONFIRMED/);
 assert.doesNotMatch(ledger,/adjustCharacterBalance|adjustCharacterWalletLPBalance|grantItemsToCharacterStationHangar|damageShip|setNpcOrder/);
 assert.match(witness,/Це ще НЕ доказ порятунку вантажу і НЕ виплата нагороди/);
});
