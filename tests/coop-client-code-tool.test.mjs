import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import path from "node:path";

const root = process.cwd();
const tool = path.join(root, "scripts/coop-client-code.py");

// The client's Python is CCP code, so it is never vendored into this repo: agents read it on
// demand (cached in %TEMP%) and the repository keeps only the derived contract files. This test
// pins the tool, its documentation and the ignore rule that keeps the cache out of git.
test("the client reader parses and stays documented", () => {
  execFileSync("python", ["-c", "import ast,sys;ast.parse(open(sys.argv[1],encoding='utf-8').read())", tool]);
  const source = readFileSync(tool, "utf8");
  for (const flag of ["--module", "--grep", "--list"]) {
    assert.ok(source.includes(flag), flag + " must exist");
  }
  assert.match(source, /never committed|never enters the repository/,
    "the no-vendoring rule is stated in the tool itself");
});

test("the decompiled cache cannot be committed", () => {
  const ignore = readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.match(ignore, /client-code\//);
  assert.match(ignore, /proprietary game or runtime artifacts/);
});

test("AGENTS.md points agents at the tool instead of a vendored copy", () => {
  const agents = readFileSync(path.join(root, "AGENTS.md"), "utf8");
  assert.match(agents, /scripts\/coop-client-code\.py/);
  assert.match(agents, /must never be committed/);
});
