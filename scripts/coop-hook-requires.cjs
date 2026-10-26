"use strict";
// A hook is one call into a module, and a module that is not installed is not a
// feature that silently does nothing: the require throws inside stock code and
// aborts the whole native tick it was attached to. Measured twice in one day -
// `Cannot find module '../coopMiningTargetGuard'` (module never registered for
// install) and `Cannot find module './coopMiningCapacitorGate.cjs'` (installed as
// .js) - each looking like "the fleet is just idle".
//
// This audit resolves every require() a hook line or an installed module makes and
// proves the target exists: co-op modules must be in the overlay's install list,
// and with --checkout every resolved path must be a real file in that tree.
//
//   node scripts/coop-hook-requires.cjs [--checkout <EveJS/Code>] [--json]
const fs = require("node:fs");
const path = require("node:path");

const REQUIRE = /require\(\s*["']([^"']+)["']\s*\)/g;

function requiresIn(text) {
  const found = [];
  REQUIRE.lastIndex = 0;
  let match;
  while ((match = REQUIRE.exec(String(text || ""))) !== null) found.push(match[1]);
  return found;
}

// Resolve a require specifier the way Node will at runtime, from the file's
// installed location inside the server tree.
function resolveTarget(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.posix.dirname(fromFile);
  const joined = path.posix.normalize(path.posix.join(base, specifier));
  return joined.replace(/\.c?js$/, "");
}

function audit({ names, specs, integrationsDir, checkout } = {}) {
  const installed = new Set(names || []);
  const targets = [];
  const push = (fromFile, specifier, origin) => {
    const resolved = resolveTarget(fromFile, specifier);
    if (!resolved) return; // node builtins and package requires are out of scope
    targets.push({ from: fromFile, specifier, resolved, origin });
  };
  for (const spec of specs || []) {
    const file = String(spec.file || "").replace(/\\/g, "/");
    for (const entry of spec.patches || []) {
      for (const specifier of requiresIn(entry && entry.line)) push(file, specifier, "hook");
    }
  }
  for (const name of installed) {
    const source = path.join(integrationsDir || "", name + ".cjs");
    let text = "";
    try { text = fs.readFileSync(source, "utf8"); } catch (_error) { continue; }
    for (const specifier of requiresIn(text)) {
      push("server/src/space/" + name + ".js", specifier, "module");
    }
  }
  const violations = [];
  let stock = 0;
  const adaptive = new Map();
  for (const name of installed) {
    try {
      const source = path.join(integrationsDir || "", name + ".cjs");
      const text = fs.readFileSync(source, "utf8");
      adaptive.set("server/src/space/" + name + ".js", {
        text,
        tries: new Set(requiresIn(text).filter((specifier) => /^\.\/[A-Za-z][A-Za-z0-9]*$/.test(specifier))),
      });
    } catch (_error) { /* module without source is reported elsewhere */ }
  }
  for (const target of targets) {
    const base = path.posix.basename(target.resolved);
    if (/^coop/i.test(base)) {
      // Our own modules are installed as <name>.js by the same overlay, so a
      // require that names one must name an installed module - and it must name it
      // without an extension, because .cjs does not exist in the installed tree.
      // The adaptive pattern (also trying the extensionless form) is allowed.
      if (!installed.has(base)) {
        violations.push({ code: "HOOK_REQUIRE_NOT_INSTALLED", ...target });
      } else if (/\.cjs$/.test(target.specifier)) {
        const owner = adaptive.get(target.from);
        const extensionless = "./" + base;
        if (!owner || !owner.tries.has(extensionless)) {
          violations.push({ code: "HOOK_REQUIRE_EXTENSION", ...target });
        }
      }
      continue;
    }
    if (!checkout) continue;
    const exists = ["js", "cjs", "json"].some((ext) =>
      fs.existsSync(path.join(checkout, target.resolved + "." + ext))) ||
      ["js", "cjs", "json"].some((ext) =>
        fs.existsSync(path.join(checkout, target.resolved, "index." + ext)));
    if (exists) stock++;
    else violations.push({ code: "HOOK_REQUIRE_MISSING_FILE", ...target });
  }
  return { targets: targets.length, installed: installed.size, stock, violations };
}

module.exports = { audit, requiresIn, resolveTarget };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--checkout");
  const checkout = at >= 0 ? argv[at + 1] : null;
  const spec = require("./overlay-spec.cjs");
  const result = audit({
    names: spec.names,
    specs: spec.specs,
    integrationsDir: path.join(__dirname, "..", "integration"),
    checkout,
  });
  if (argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else if (result.violations.length === 0) {
    console.log("HOOK_REQUIRES_OK targets=" + result.targets +
      " installed=" + result.installed + " stock=" + result.stock);
  } else {
    console.log("HOOK_REQUIRES_VIOLATIONS " + result.violations.length);
    for (const violation of result.violations.slice(0, 20)) {
      console.log("  " + violation.code + " " + violation.origin + " " +
        violation.from + " -> " + violation.specifier +
        " (resolved " + violation.resolved + ")");
    }
  }
  process.exit(result.violations.length === 0 ? 0 : 1);
}
