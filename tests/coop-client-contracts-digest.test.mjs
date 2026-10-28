import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

// A cloud agent cannot decompile the client, so the contracts it enforces must live in the repo
// as derived data: names, locations and semantics only, never client code.
test("the field-read digest is committed and honest about its coverage", () => {
  const digest = JSON.parse(read("docs/client-contracts/field-reads.json"));
  assert.ok(digest.source.includes("no client code"), "the digest states what it is");
  const calls = Object.keys(digest.calls);
  assert.ok(calls.length > 400, "it covers the client's calls: " + calls.length);
  const withFields = calls.filter((key) => {
    const entry = digest.calls[key];
    return entry.fields.length || entry.columns.length;
  });
  assert.ok(withFields.length > 0, "some calls are resolved");
  assert.ok(withFields.length < calls.length / 2,
    "the extractor follows wrappers poorly - the document must not pretend otherwise");
});

test("the curated contract list exists and cites its evidence", () => {
  const doc = read("docs/CLIENT_CONTRACTS.md");
  for (const citation of [
    "fwwarzone/client/dashboard/warzoneMap.py",
    "factionwarfare/advantageState.py",
    "eve/client/script/ui/shared/comtool/onlineStatus.py",
    "campaigns/client/messengers/campaigns_messenger.py",
  ]) {
    assert.ok(doc.includes(citation), "missing evidence: " + citation);
  }
  assert.match(doc, /nothing read|not derivable automatically/,
    "the document must say what a missing entry means");
});

test("the derived artifacts are all committed", () => {
  for (const file of [
    "docs/client-contracts/calls.json",
    "docs/client-contracts/gateway-types.json",
    "docs/client-contracts/field-reads.json",
    "docs/client-contracts/baseline.json",
    "docs/CLIENT_CONTRACT_STATUS.md",
    "docs/CLIENT_GAPS.md",
    "docs/CLIENT_CONTRACTS.md",
  ]) {
    assert.ok(read(file).length > 100, file + " must exist in the repository");
  }
});
