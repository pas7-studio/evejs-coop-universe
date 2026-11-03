import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// The client builds a native DBRow per contact from GetInitialState's header:
//   blue.DBRow(self.onlineStatus.header, [charID, True])
// Its C constructor parses each column with PyArg_ParseTuple, so a column that
// is not a (name, DBType) tuple raised on every call:
//   UnmarshalError: new style getargs format but argument is not a tuple
// This test freezes the wire shape that fixes it.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const payloadPath = path.join(
  forkRoot,
  "Code/server/src/services/online/onlineStatusPayload.js",
);
const {
  DBTYPE_BOOL,
  DBTYPE_I4,
  buildOnlineStatusDescriptor,
  buildOnlineStatusRowset,
} = require(payloadPath);

test("every onlineStatus column is a (name, DBType) marshal tuple", () => {
  const descriptor = buildOnlineStatusDescriptor();
  assert.equal(descriptor.type, "objectex1");
  assert.deepEqual(descriptor.header[0], {type: "token", value: "blue.DBRowDescriptor"});
  const columns = descriptor.header[1][0];
  assert.equal(columns.length, 2);
  for (const column of columns) {
    assert.equal(column.type, "tuple", "a list here is what raises in the C constructor");
    assert.equal(column.items.length, 2);
    assert.equal(typeof column.items[0], "string");
    assert.equal(typeof column.items[1], "number");
  }
  assert.deepEqual(columns[0].items, ["contactID", DBTYPE_I4]);
  assert.deepEqual(columns[1].items, ["online", DBTYPE_BOOL]);
});

test("GetInitialState advertises the same column names and keeps the rowset shape", () => {
  const rowset = buildOnlineStatusRowset([
    [140000005, true],
    [140000107, false],
  ]);
  assert.equal(rowset.type, "object");
  assert.equal(rowset.name, "eve.common.script.sys.rowset.Rowset");
  const entries = new Map(rowset.args.entries);
  assert.deepEqual(entries.get("columns").items, ["contactID", "online"]);
  assert.deepEqual(entries.get("RowClass"), {type: "token", value: "util.Row"});
  assert.equal(entries.get("header").type, "objectex1");
  assert.deepEqual(entries.get("lines").items, [
    [140000005, true],
    [140000107, false],
  ]);
});
