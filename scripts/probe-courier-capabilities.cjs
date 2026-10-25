"use strict";
// Read-only capability probe for the courier driver. Loads the real upstream
// modules in this process and reports which native capabilities the driver's
// preflight requires. It never mutates anything: no contract, wallet, item or
// scene is touched.
const path = require("path");
const SPACE = "/app/server/src/space";

function safeRequire(relative) {
  try {
    return { ok: true, module: require(path.join(SPACE, relative)) };
  } catch (error) {
    return { ok: false, error: String(error && error.message || error).slice(0, 160) };
  }
}

function has(module, name) {
  return Boolean(module && typeof module[name] === "function");
}

const transitions = safeRequire("transitions");
const runtime = safeRequire("runtime");

console.log("transitions loaded:", transitions.ok, transitions.ok ? "" : transitions.error);
console.log("runtime loaded:", runtime.ok, runtime.ok ? "" : runtime.error);

const checks = [];
if (transitions.ok) {
  checks.push(["transitions.undockSession", has(transitions.module, "undockSession")]);
  checks.push(["transitions.dockSession", has(transitions.module, "dockSession")]);
}
if (runtime.ok) {
  checks.push(["runtime.warpToPoint", has(runtime.module, "warpToPoint")]);
  const names = runtime.module ? Object.keys(runtime.module) : [];
  const shipish = names.filter((name) => /entity.*character|character.*entity|shipEntity|getActiveShip/i.test(name));
  console.log("\nruntime exports matching ship/entity lookups:", shipish.length ? shipish.join(", ") : "(none)");
  const warpish = names.filter((name) => /warp/i.test(name));
  console.log("runtime exports matching warp:", warpish.length ? warpish.slice(0, 8).join(", ") : "(none)");
}

console.log("\ndriver preflight requirements:");
let missing = 0;
for (const [name, present] of checks) {
  if (!present) missing += 1;
  console.log(`  ${present ? "PRESENT" : "MISSING"}  ${name}`);
}
console.log(missing === 0 ? "\nPREFLIGHT_STATIC_READY" : `\nPREFLIGHT_STATIC_BLOCKED (${missing} missing)`);
