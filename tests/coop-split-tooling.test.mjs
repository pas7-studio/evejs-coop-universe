// The split tools are the reason a live war phase stopped advancing: the splitter
// only saw the FIRST name of `let world=null,bridge=null,...`, moved code that
// assigns `bridge`, and the running server threw ReferenceError the moment that
// phase ran. `node --check`, `require()` and every text assertion were happy.
//
// These cases pin the two things that make that impossible now: the splitter sees
// every declarator, and a split is verified statically before it is kept.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { bindingNames, moduleLevelNames, assignedNames, usedNames, stripComments }
  from "../scripts/lib/js-declarations.cjs";

const ROOT = path.join(import.meta.dirname, "..");
const SPLITTER = path.join(ROOT, "scripts", "coop-split-module.cjs");
const CHECKER = path.join(ROOT, "scripts", "coop-split-check.cjs");

function fixture(files) {
  const code = fs.mkdtempSync(path.join(os.tmpdir(), "coop-split-"));
  const src = path.join(code, "server", "src", "space");
  fs.mkdirSync(src, { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(src, name), body);
  return { code, src };
}

function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  // stderr can carry the inspector bootloader banner; stdout is the tool's answer.
  return { code: result.status, out: `${result.stdout}${result.stderr}`, stdout: result.stdout };
}

test("a declarator list is read in full, not just its first name", () => {
  const text = stripComments("let world=null, bridge=null, warpDirector=null;\n");
  assert.deepEqual([...bindingNames("world=null, bridge=null, warpDirector=null")],
    ["world", "bridge", "warpDirector"]);
  assert.deepEqual([...moduleLevelNames(text)], ["world", "bridge", "warpDirector"]);
});

test("every name of a let line counts as module state for the splitter", () => {
  const { code } = fixture({
    "fixtureRuntime.js": [
      '"use strict";',
      "let world=null, bridge=null;",
      "let counter=0;",
      "function warPhase(){",
      " if(!bridge)bridge=require('./x');",
      " counter+=1;",
      " return world;",
      "}",
      "function distanceBetween(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}",
      "module.exports={warPhase,distanceBetween};",
      "",
    ].join("\n"),
  });
  const result = run(SPLITTER, ["--code-path", code, "--file", "space/fixtureRuntime.js", "--json"]);
  assert.equal(result.code, 0, result.out);
  const report = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
  assert.ok(report.mutableState.includes("bridge"), "bridge is module state");
  assert.ok(report.mutableState.includes("counter"));
  assert.ok(!report.names.includes("warPhase"), "a function that writes state never moves");
  const warPhase = report.declarationsDetail.find((d) => d.name === "warPhase");
  assert.equal(warPhase.movable, false);
});

test("the checker refuses a sibling that assigns a name it does not declare", () => {
  const { code } = fixture({
    "bad.js": '"use strict";\nlet warpDirector=null;\nmodule.exports={warpDirector};\n',
    "bad.pure.js": '// Extracted from space/bad.js by scripts/coop-split-module.cjs.\n"use strict";\nfunction nativeWarpPoint(){ if(!warpDirector)warpDirector=require("./w"); return warpDirector; }\nmodule.exports={nativeWarpPoint};\n',
  });
  const result = run(CHECKER, ["--code-path", code, "--parent", "space/bad.js", "--sibling", "space/bad.pure.js"]);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /COUPLING warpDirector/);
  assert.equal(usedNames(stripComments("if(!warpDirector)warpDirector=require(\"./w\");")).has("warpDirector"), true);
});

test("the checker refuses a split with two copies of one piece of state", () => {
  const { code } = fixture({
    "pair.js": '"use strict";\nlet state=null;\nconst {read}=require("./pair.pure");\nmodule.exports={read};\n',
    "pair.pure.js": '// Extracted from space/pair.js by scripts/coop-split-module.cjs.\n"use strict";\nlet state=null;\nfunction read(){return state;}\nmodule.exports={read};\n',
  });
  const result = run(CHECKER, ["--code-path", code, "--parent", "space/pair.js", "--sibling", "space/pair.pure.js"]);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /TWO_STATES state: declared in both/);
  assert.doesNotMatch(result.out, /COUPLING/, "the sibling declares it, so it is not a coupling");
});

test("a clean split is accepted and the parent keeps every moved name", () => {
  const { code, src } = fixture({
    "ok.js": [
      '"use strict";',
      "let state=null;",
      "function touchesState(){ state=1; return state; }",
      "function distanceBetween(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}",
      "function boom(){ state=2; return state; }",
      "module.exports={touchesState,distanceBetween,boom};",
      "",
    ].join("\n"),
  });
  const applied = run(SPLITTER, ["--code-path", code, "--file", "space/ok.js", "--apply"]);
  assert.equal(applied.code, 0, applied.out);
  assert.ok(fs.existsSync(path.join(src, "ok.pure.js")), "the sibling was written");
  const parent = fs.readFileSync(path.join(src, "ok.js"), "utf8");
  assert.match(parent, /require\("\.\/ok\.pure"\)/);
  assert.match(parent, /function touchesState/, "state-touching code stayed in the parent");
  const checked = run(CHECKER, ["--code-path", code]);
  assert.equal(checked.code, 0, checked.out);
  assert.match(checked.out, /SPLIT_OK space\/ok\.pure\.js/);
});

test("a used name is not invented by regex backtracking", () => {
  // `actionID` used to be reported as `actionI`, which made every long identifier
  // look like a free variable.
  const names = usedNames(stripComments("const x = actionID + characterStationID;\n"));
  assert.ok(names.has("actionID"));
  assert.ok(!names.has("actionI"));
  // A member call and an object key are not references to a binding.
  const member = usedNames(stripComments("instance.start();\nconst o = { start: 1 };\n"));
  assert.ok(!member.has("start"));
  assert.ok(assignedNames(stripComments("x = 1;\n")).has("x"));
});
