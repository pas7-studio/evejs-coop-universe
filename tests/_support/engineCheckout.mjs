// The engine checkout: the code that actually ships.
//
// Since D1 ("we own the fork") the deployed server source is this checkout, and a
// large part of the suite already reads it - 59 test files - but each resolved it
// its own way: some from EVEJS_COOP_CODE_PATH with no default (so the test quietly
// skipped), one from EVEJS_CODE_PATH, one with an empty-string default (so it
// failed). A test's coverage therefore depended on the shell it was started from.
//
// One resolution instead: the env var if set, otherwise the documented local
// checkout. `engineAvailable` lets a test skip with a reason instead of failing
// with ENOENT, and `engineSource(rel)` reads a path relative to `Code/`.
import fs from "node:fs";
import path from "node:path";

export const ENGINE_CODE =
  process.env.EVEJS_COOP_CODE_PATH ||
  process.env.EVEJS_CODE_PATH ||
  "C:\\Games\\EveCoop\\upstream-evejs\\Code";

export const engineAvailable = fs.existsSync(path.join(ENGINE_CODE, "server", "src"));

/** Source of `rel` (relative to `Code/`, e.g. "server/src/space/npc/nativeNpcStore.js"). */
export function engineSource(rel) {
  return fs.readFileSync(path.join(ENGINE_CODE, rel), "utf8");
}

/** Skip `t` (the test context) with a clear reason when the checkout is absent. */
export function skipWithoutEngine(t) {
  if (engineAvailable) return false;
  t.skip(`engine checkout not found at ${ENGINE_CODE} (set EVEJS_COOP_CODE_PATH)`);
  return true;
}
