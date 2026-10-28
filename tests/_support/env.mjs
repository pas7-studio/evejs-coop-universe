// Feature flags for one test, and the undo.
//
// Most co-op tests turn a handful of `EVEJS_COOP_*` switches on, run one module
// and put the environment back. That is four lines of bookkeeping per test, and
// the details are easy to get wrong in ways nothing notices: `process.env.X =
// undefined` stores the STRING "undefined" (truthy for the code under test), and
// a restore that sets instead of deletes leaks a flag into every later test in
// the same file. One implementation, asserted in coop-env-support.test.mjs.
//
// Nothing here reads a flag: the values are exactly what the caller passes.
//
//   const restore = swapEnv({EVEJS_COOP_X: "1", EVEJS_COOP_Y: undefined});
//   ...                                // Y is deleted for the duration
//   restore();                         // back to what it was, including unset
//
// Inside a test, `withEnv(t, values)` registers the restore with the test
// context, so a failing assertion still cleans up:
//
//   test("...", (t) => { withEnv(t, FLAGS.map((f) => [f, "1"])); ... });

const asObject = (values) =>
  Array.isArray(values) ? Object.fromEntries(values) : values;

/** Apply `values` to process.env; returns the undo. Unset or `undefined` = delete. */
export function swapEnv(values) {
  const saved = new Map();
  for (const [name, value] of Object.entries(asObject(values) || {})) {
    saved.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = String(value);
  }
  return () => {
    for (const [name, was] of saved) {
      if (was === undefined) delete process.env[name];
      else process.env[name] = was;
    }
  };
}

/** `swapEnv` plus `ctx.after(restore)`, so the undo runs even when a test throws. */
export function withEnv(ctx, values) {
  const restore = swapEnv(values);
  if (ctx && typeof ctx.after === "function") ctx.after(restore);
  return restore;
}
