import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const machoErrors = require(
  path.join(forkRoot, "Code/server/src/common/machoErrors.js"),
);

test("a wrapped user error reports its user-error name for the server log", () => {
  let thrown = null;
  try {
    machoErrors.throwWrappedUserError("NotEnoughCargoSpace", { type: 34 });
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, "throwWrappedUserError must throw");
  const described = machoErrors.describeMachoWrappedError(thrown);
  assert.match(described, /UserError/, "class name must be visible");
  assert.match(described, /NotEnoughCargoSpace/, "user error name must be visible");
  assert.doesNotMatch(
    described,
    /^Wrapped remote exception$/,
    "the generic message alone tells an operator nothing",
  );
});

test("a wrapped object error without a message still names its class", () => {
  let thrown = null;
  try {
    machoErrors.throwWrappedObject("carbon.common.script.net.objectCaching.CacheOK", ["CacheOK"]);
  } catch (error) {
    thrown = error;
  }
  assert.equal(
    machoErrors.describeMachoWrappedError(thrown),
    "carbon.common.script.net.objectCaching.CacheOK: CacheOK",
  );
});

test("an ordinary error keeps its own message", () => {
  assert.equal(
    machoErrors.describeMachoWrappedError(new Error("plain failure")),
    "plain failure",
  );
});
