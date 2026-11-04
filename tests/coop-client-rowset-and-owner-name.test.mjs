import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import path from "node:path";

// Two live client tracebacks from 2026-11-03, both py2 unicode/class-resolution traps:
//
//  EXCEPTION #9  contractProxy state -> UnmarshalError: 'module' object has no attribute
//                'Rowset'   (util.Rowset does not exist in V23.02/V24.01)
//  EXCEPTION #15 overview PrimeDisplayName -> ExtractLocalizedTags(text='SaSaNyah') ->
//                TypeError: must be unicode, not str   (cfg.eveowners name sent as py2 str)
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const srcRoot = path.join(forkRoot, "Code/server/src");
const require = createRequire(import.meta.url);
const helpers = require(path.join(srcRoot, "services/_shared/serviceHelpers.js"));
const marshal = require(path.join(srcRoot, "network/tcp/utils/marshal.js"));

const CLIENT_ROWSET = "eve.common.script.sys.rowset.Rowset";

test("rowsets encode the class the client can actually import", () => {
  const buffer = Buffer.from(
    marshal.marshalEncode(helpers.buildRowset(["contractID", "state"], [])),
  );
  const text = buffer.toString("latin1");
  assert.ok(
    text.includes(CLIENT_ROWSET),
    "the rowset class must be the importable eve.common.script.sys.rowset.Rowset",
  );
  assert.equal(
    text.includes("util.Rowset"),
    false,
    "util.Rowset raises AttributeError on the client and must never be sent",
  );
});

test("no payload builder still names util.Rowset", () => {
  for (const relative of [
    "services/chat/chatHub.js",
    "services/account/accountService.js",
  ]) {
    const source = readFileSync(path.join(srcRoot, relative), "utf8");
    const payloadLines = source
      .split("\n")
      .filter((line) => line.includes('"util.Rowset"') && !line.trim().startsWith("//"));
    assert.deepEqual(payloadLines, [], `${relative} still sends util.Rowset`);
  }
});

test("cfg.eveowners names are marshalled as unicode", () => {
  // The client stores these rows in cfg.eveowners, whose .name is fed to
  // ExtractLocalizedTags, so a py2 byte str raises "must be unicode, not str".
  const ownerRow = {
    type: "list",
    items: [
      {type: "wstring", value: "SaSaNyah"},
      "SaSaNyah",
    ],
  };
  const bytes = Buffer.from(marshal.marshalEncode(ownerRow));
  const name = Buffer.from("SaSaNyah", "utf8");
  const first = bytes.indexOf(name);
  const second = bytes.indexOf(name, first + 1);
  assert.equal(bytes[first - 2], 0x2e, "unicode string opcode (PyWStringUTF8)");
  assert.equal(bytes[second - 2], 0x13, "plain opcode stays a byte str - that is the bug");
});

test("both owner registries send the name as wstring", () => {
  for (const relative of [
    "services/corporation/corpRegistryRuntime.js",
    "services/corporation/allianceRegistryRuntime.js",
  ]) {
    const source = readFileSync(path.join(srcRoot, relative), "utf8");
    assert.ok(
      source.includes('{ type: "wstring", value: String(record.ownerName ?? "") }'),
      `${relative} must marshal ownerName as wstring`,
    );
  }
});

test("public character info sends the name as unicode", () => {
  // A pilot outside our corporation reaches cfg.eveowners only through GetPublicInfo /
  // GetPublicInfo3, so this is the producer behind the repeated 'SaSaNyah' traceback.
  const source = readFileSync(path.join(srcRoot, "services/character/charMgrService.js"), "utf8");
  const at = source.indexOf('"characterName"');
  assert.ok(at > 0, "characterName entry must exist");
  const entry = source.slice(at, at + 400);
  assert.ok(
    entry.includes('type: "wstring"'),
    "characterName must be marshalled as wstring, not a py2 byte str",
  );
});
