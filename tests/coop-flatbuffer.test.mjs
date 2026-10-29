import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// Our flatbuffer writer. The client parses these files with generated code, so a wrong vtable or a
// wrong uoffset shows up as a crash in game. The test reads the buffer the way the client does,
// with a deliberately separate reader.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {FlatbufferBuilder} = require(path.join(forkRoot, "Code/server/src/space/coopFlatbuffer.js"));

function reader(buffer) {
  const root = buffer.readUInt32LE(0);
  const tableAt = (pos) => ({
    pos,
    vtable: pos - buffer.readInt32LE(pos),
    field(slot) {
      const entry = buffer.readUInt16LE(this.vtable + 4 + slot * 2);
      return entry === 0 ? 0 : pos + entry;
    },
    string(slot) {
      const at = this.field(slot);
      if (!at) return null;
      const target = at + buffer.readUInt32LE(at);
      const length = buffer.readUInt32LE(target);
      return buffer.toString("utf8", target + 4, target + 4 + length);
    },
    uint32(slot) {
      const at = this.field(slot);
      return at ? buffer.readUInt32LE(at) : 0;
    },
    vector(slot) {
      const at = this.field(slot);
      if (!at) return [];
      const start = at + buffer.readUInt32LE(at);
      const count = buffer.readUInt32LE(start);
      return Array.from({length: count}, (_, index) => {
        const element = start + 4 + index * 4;
        return tableAt(element + buffer.readUInt32LE(element));
      });
    },
  });
  return tableAt(root);
}

test("a real table, its scalars, strings and a vector of tables round-trip", () => {
  const builder = new FlatbufferBuilder();
  const rows = ["Belt Breaker", "Founder"].map((name, index) => {
    const id = builder.createString(`uuid-${index}`);
    const icon = builder.createString("icon.svg");
    builder.startTable(3);
    builder.slot(0, id);
    builder.scalarSlot(1, 42 + index);
    builder.slot(2, icon);
    return builder.endTable();
  });
  const list = builder.createVectorOfOffsets(rows);
  builder.startTable(1);
  builder.slot(0, list);
  const root = builder.endTable();
  const bytes = Buffer.from(builder.finish(root, "TEST"));

  assert.equal(bytes.toString("utf8", 4, 8), "TEST", "the file identifier sits after the root offset");
  const parsed = reader(bytes);
  const entries = parsed.vector(0);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].string(0), "uuid-0");
  assert.equal(entries[0].uint32(1), 42);
  assert.equal(entries[0].string(2), "icon.svg");
  assert.equal(entries[1].string(0), "uuid-1");
  assert.equal(entries[1].uint32(1), 43);
});

test("an absent field stays absent instead of becoming zero", () => {
  const builder = new FlatbufferBuilder();
  const id = builder.createString("only-id");
  builder.startTable(3);
  builder.slot(0, id);
  const row = builder.endTable();
  builder.startTable(1);
  builder.slot(0, row);
  const bytes = Buffer.from(builder.finish(builder.endTable(), "TEST"));

  const root = bytes.readUInt32LE(0);
  const nestedAt = (() => {
    const vtable = root - bytes.readInt32LE(root);
    const offset = bytes.readUInt16LE(vtable + 4);
    return root + offset + bytes.readUInt32LE(root + offset);
  })();
  const nestedVtable = nestedAt - bytes.readInt32LE(nestedAt);
  const vtableSize = bytes.readUInt16LE(nestedVtable);
  // the client's Table.Offset checks the vtable size before reading an entry; so does this
  const slot = (index) => {
    const entryAt = 4 + index * 2;
    if (entryAt >= vtableSize) return 0;
    const offset = bytes.readUInt16LE(nestedVtable + entryAt);
    return offset === 0 ? 0 : nestedAt + offset;
  };
  assert.ok(slot(0) > 0, "the id is there");
  assert.equal(slot(1), 0, "a slot we never wrote is 0, which is how flatbuffers means absent");
  assert.equal(slot(2), 0);
});
