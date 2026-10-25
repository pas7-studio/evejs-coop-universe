import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
test('readonly diagnosis never auto-deploys or writes to persistent volume',()=>{
 const code=fs.readFileSync(path.join(root,'scripts','Diagnose-Coop-Telemetry.ps1'),'utf8');
 for(const expr of [/docker compose @opts exec -T server sh -c "echo \$encodedCheck \| base64 -d \| sh -s"/,/docker inspect --format/,/PROJECT_PROBE_SHA256/,/START_HOOK: ABSENT/,/CONFIG_EVENTS_PATH: MISSING_OR_DIFFERENT/,/EVENTS_FILE: ABSENT_OR_UNREADABLE/])assert.match(code,expr);
 for(const expr of [/docker compose @opts (?:up|down|build|run|restart)/,/Remove-Item/,/Set-Content/,/docker volume rm/,/sh -c .*mkdir/])assert.doesNotMatch(code,expr);
});