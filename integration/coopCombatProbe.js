"use strict";
// Repo-test shim: integration/*.cjs call require("./coopCombatProbe") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopCombatProbe.cjs to Code/server/src/space/coopCombatProbe.js, so this file is never shipped.
module.exports = require("./coopCombatProbe.cjs");
