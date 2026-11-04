import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// The client's online-status service calls
//   GetInitialState().Index('contactID')
// and later builds a native row per contact from the same header:
//   blue.DBRow(self.onlineStatus.header, [charID, True])
// `Index` only exists on dbutil.CRowset (carbon.common.script.sys.crowset),
// whose header must be a blue.DBRowDescriptor and whose rows must be DBRows.
// Serving a plain eve Rowset raised, on every contact refresh:
//   AttributeError: 'blue.DBRowDescriptor' object has no attribute 'index'
// This test freezes the CRowset wire shape that fixes it.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const payloadPath = path.join(
  forkRoot,
  "Code/server/src/services/online/onlineStatusPayload.js",
);
const {
  DBTYPE_BOOL,
  DBTYPE_I4,
  ONLINE_STATUS_ROWSET_NAME,
  buildOnlineStatusDescriptor,
  buildOnlineStatusRowset,
} = require(payloadPath);

test("the header is a DBRowDescriptor whose columns are (name, DBType) tuples", () => {
  const descriptor = buildOnlineStatusDescriptor();
  assert.equal(descriptor.type, "objectex1");
  assert.deepEqual(descriptor.header[0], {type: "token", value: "blue.DBRowDescriptor"});
  const columns = descriptor.header[1][0];
  assert.equal(columns.length, 2);
  for (const column of columns) {
    assert.equal(Array.isArray(column), true, "arrays marshal as tuples; a bare name breaks the C constructor");
    assert.equal(column.length, 2);
    assert.equal(typeof column[0], "string");
    assert.equal(typeof column[1], "number");
  }
  assert.deepEqual(columns[0], ["contactID", DBTYPE_I4]);
  assert.deepEqual(columns[1], ["online", DBTYPE_BOOL]);
});

test("GetInitialState returns dbutil.CRowset so the client can call .Index('contactID')", () => {
  const rowset = buildOnlineStatusRowset([
    [140000005, true],
    [140000107, false],
  ]);
  assert.equal(rowset.type, "objectex2");
  assert.equal(ONLINE_STATUS_ROWSET_NAME, "carbon.common.script.sys.crowset.CRowset");
  assert.deepEqual(rowset.header[0][0], {type: "token", value: ONLINE_STATUS_ROWSET_NAME});
  const attributes = new Map(rowset.header[1].entries);
  assert.equal(attributes.get("header").type, "objectex1");
  assert.equal(rowset.list.length, 2);
  for (const row of rowset.list) {
    assert.equal(row.type, "packedrow");
    assert.equal(row.header.type, "objectex1");
    assert.deepEqual(row.values, row.values.slice());
  }
  assert.deepEqual(rowset.list[0].values, [140000005, true]);
  assert.deepEqual(rowset.list[1].values, [140000107, false]);
});
