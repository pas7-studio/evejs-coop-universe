// The source-text helper is test infrastructure: if it silently stops inlining a
// split sibling, dozens of wiring tests would keep passing while covering code
// that no longer exists in the file they claim to read. These four cases pin the
// contract that makes a split safe.
import test from "node:test";
import assert from "node:assert/strict";
import { readModuleText, moduleFiles, functionText } from "./_support/coopSourceText.mjs";

const SPLIT_PARENT = "integration/coopVirtualWorldRuntime.cjs";
const SPLIT_CHILD = "integration/coopVirtualWorldRuntime.pure.cjs";

test("a split sibling is inlined, so moved code stays covered", () => {
  const text = readModuleText(SPLIT_PARENT);
  assert.ok(text.includes("coopVirtualWorldRuntime.pure.cjs"), "the sibling file is expanded");
  // distanceBetween moved into the pure module: the assertion must still find it.
  assert.match(text, /function distanceBetween\(/);
  assert.ok(moduleFiles(SPLIT_PARENT).includes(SPLIT_CHILD));
});

test("depth 0 means this exact file, for body execution and slicing", () => {
  const only = readModuleText(SPLIT_PARENT, { depth: 0 });
  assert.ok(!only.includes("/* ---- "), "no sibling text is inlined");
  assert.ok(!only.includes("function distanceBetween("), "the moved declaration is gone");
  assert.ok(only.length < readModuleText(SPLIT_PARENT).length);
});

test("an unrelated module is never inlined into a script that merely requires it", () => {
  // scripts/patch-evejs-coop.cjs requires overlay-spec.cjs, which names modules;
  // a doesNotMatch on the installer must not trip over the imported copy.
  const spec = readModuleText("scripts/overlay-spec.cjs");
  const installer = readModuleText("scripts/patch-evejs-coop.cjs");
  assert.ok(spec.includes('"coopAlifeNativeMiningWitness"'));
  assert.ok(installer.length < spec.length + 400_000, "no unrelated module was inlined");
});

test("functionText returns one whole function, ending at its closing brace", () => {
  const text = readModuleText(SPLIT_PARENT);
  const body = functionText(text, "function observeNativeMiningProof()");
  assert.ok(body.startsWith("function observeNativeMiningProof(){"));
  assert.ok(body.endsWith("}"), "the body is closed");
  assert.match(body, /getMiningFleetsForSystem\(systemID\)/, "the whole body is present");
  assert.equal(functionText(text, "function doesNotExist()"), "");
});
