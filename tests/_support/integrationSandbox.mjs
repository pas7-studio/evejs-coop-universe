import {createRequire} from "node:module";
import {readFileSync} from "node:fs";

const require = createRequire(import.meta.url);

/**
 * Compile a repo-mirrored integration module the way the deployed tree loads it.
 *
 * `integration/*.cjs` is the engine's `.js` tree renamed, so the modules keep
 * `require("./sibling")` without an extension. Node's CJS resolver never tries
 * `.cjs`, so a sandbox that only forwards `require(id)` throws MODULE_NOT_FOUND
 * from the test directory - or, inside a `try/catch`, silently turns into a
 * pause status and rewrites what the test proves. This loader resolves a bare
 * sibling against `integration/<name>.cjs` first and lets `overrides` win over
 * both, so a deliberate stub stays explicit.
 */
export function loadIntegration(name, overrides = {}) {
  const source = readFileSync(
    new URL(`../../integration/${name}.cjs`, import.meta.url), "utf8");
  const compiled = {exports: {}};
  new Function("require", "module", "exports", source)(
    (id) => {
      if (Object.prototype.hasOwnProperty.call(overrides, id)) return overrides[id];
      if (typeof id === "string" && id.startsWith("./") && !id.slice(2).includes("/"))
        return require(`../../integration/${id.slice(2)}.cjs`);
      return require(id);
    },
    compiled, compiled.exports);
  return compiled.exports;
}
