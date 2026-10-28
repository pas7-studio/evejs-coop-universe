// A session with no client must still be able to trust what the repo says about it.
//
// The client is CCP code and is never committed: what the repository keeps is derived
// (`docs/client-contracts/*.json`, `docs/CLIENT_CONTRACT_STATUS.md`, `docs/CLIENT_GAPS.md`).
// A web or cloud agent cannot run the decompiler - it has no `tq/code.ccp`, often no Python
// and no Windows machine - so the contract it reads must be provable from committed data
// alone. `--verify` does exactly that: it rebuilds the register and the baseline from
// `calls.json` plus the server tree and refuses a stale or dishonest record.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = resolve(root, "scripts/coop-client-contracts.cjs");

function run(mode) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [script, mode],
      { encoding: "utf8", cwd: root, stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (error) {
    return { code: error.status || 1, out: String(error.stdout || "") + String(error.stderr || "") };
  }
}

test("the client contract is verifiable without the client archive", () => {
  const { code, out } = run("--verify");
  assert.equal(code, 0, out.slice(0, 600));
  assert.match(out, /CONTRACTS_OFFLINE_OK/);
  assert.match(out, /client_archive_required=no/, "no step may need tq/code.ccp");
});

test("the register still covers the faction-warfare surfaces the co-op world feeds", () => {
  const calls = JSON.parse(readFileSync(resolve(root, "docs/client-contracts/calls.json"), "utf8")).calls;
  // calls.json is keyed by the call itself: { "svc.Method": { sites, modules } }
  const keys = new Set(Object.keys(calls));
  for (const key of ["fwWarzoneSolarsystem.GetAllWarzones",
    "fwWarzoneSolarsystem.GetAllWarzonesOccupationStates",
    "fwWarzoneSolarsystem.GetLocalOccupationState",
    "fwWarzoneSolarsystem.GetHQSystemIDs",
    "insurgencySolarsystem.GetLocalCampaignClientSnapshot"]) {
    assert.ok(keys.has(key), `the client calls ${key} and the register must record it`);
  }
});

test("no recorded client call is missing a handler", () => {
  const register = readFileSync(resolve(root, "docs/CLIENT_CONTRACT_STATUS.md"), "utf8");
  const counts = /MISSING (\d+)/.exec(register);
  assert.ok(counts, "the register states its own counts");
  assert.equal(Number(counts[1]), 0, "a MISSING call would be a surface that opens empty");
});
