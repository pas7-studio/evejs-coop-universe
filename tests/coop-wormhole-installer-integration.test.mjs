import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installerPath = path.join(repoRoot, "scripts/patch-evejs-coop.cjs");
const { names, specs, PIN, transform } = require("../scripts/patch-evejs-coop.cjs");
const { fileName, hookBegin, hookComplete } = require("../scripts/coop-wormhole-jump-fence-patch.cjs");
const target = specs.find(spec => spec.file === fileName);

function fixture(eol = "\n") {
  return [
    "function completeWormholeJump({ session, sourceScene, sourceEndpointID, shipMass, prepareResult }) {",
    "  if (!session || !prepareResult || !prepareResult.data) return;",
    "  const pendingJump = session._wormholeJumpPending;",
    "  if (!pendingJump) return;",
    "}",
    "class WormholeMgrService extends BaseService {",
    "  Handle_WormholeJump(args, session) {",
    "    const endpointID = toInt(args && args[0], 0);",
    "    return endpointID;",
    "  }",
    "}",
    ""
  ].join(eol);
}

test("central installer is parseable JavaScript (guards accidental literal escaped newlines)", () => {
  const source = fs.readFileSync(installerPath, "utf8");
  assert.doesNotThrow(() => new vm.Script(source, { filename: installerPath }));
  assert.equal(source.includes(String.raw`let text=strip(source);\n`), false);
  assert.equal(source.includes(String.raw`coopPochvenConduit");\nconst specs`), false);
});

test("single central installer owns the registered native wormhole hook and deployed module", () => {
  assert.equal(names.filter(name => name === "coopWormholeJumpFence").length, 1);
  assert.equal(specs.filter(spec => spec.file === fileName).length, 1);
  assert.ok(target);
  assert.equal(target.patches.length, 0);
  assert.equal(PIN, "c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f");
  assert.ok(fs.existsSync(path.join(repoRoot, "integration/coopWormholeJumpFence.cjs")));
  assert.ok(fs.existsSync(path.join(repoRoot, "scripts/coop-wormhole-jump-fence-patch.cjs")));
});

for (const eol of ["\n", "\r\n"]) {
  test(`installer composes wormhole hook exactly once and reverses byte-for-byte (${eol === "\n" ? "LF" : "CRLF"})`, () => {
    const source = fixture(eol);
    const applied = transform(source, target, false);
    assert.equal(applied.split(hookBegin).length - 1, 1);
    assert.equal(applied.split(hookComplete).length - 1, 1);
    assert.match(applied, /EVEJS_COOP_WORMHOLE_JUMP_FENCE === "1"/);
    assert.equal(transform(applied, target, false), applied);
    assert.equal(transform(applied, target, true), source);
    assert.equal(transform(source, target, true), source);
    assert.doesNotThrow(() => new vm.Script(applied));
  });
}

test("unrelated stargate and warp native sources do not receive wormhole hooks", () => {
  for (const name of ["server/src/space/transitions.js", "server/src/services/ship/beyonceService.js"]) {
    const spec = specs.find(entry => entry.file === name);
    assert.ok(spec);
    assert.notEqual(spec.file, fileName);
    assert.equal(spec.patches.some(entry => entry.line?.includes("coopWormholeJumpFence")), false);
  }
});

test("actual pinned native wormhole service roundtrip, if authorized checkout provided", (t) => {
  const codePath = process.env.EVEJS_COOP_CODE_PATH;
  if (!codePath) { t.skip("Set EVEJS_COOP_CODE_PATH to pristine pinned EveJS/Code checkout"); return; }
  const checkoutRoot = path.dirname(path.resolve(codePath));
  const revision = execFileSync("git", ["-C", checkoutRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(revision, PIN, "Never verify the wrong native version as compatible");
  const nativePath = path.join(codePath, fileName);
  const deployed = fs.readFileSync(nativePath, "utf8");
  const original = transform(deployed, target, true);
  const applied = transform(original, target, false);
  assert.equal(transform(applied, target, false), applied);
  assert.equal(transform(applied, target, true), original);
  assert.doesNotThrow(() => new vm.Script(applied, { filename: fileName }));
});
