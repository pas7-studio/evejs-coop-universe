"use strict";
// Repo-test shim: integration/*.cjs call require("./coopPlayerCombatWitness") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopPlayerCombatWitness.cjs to Code/server/src/space/coopPlayerCombatWitness.js, so this file is never shipped.
module.exports = require("./coopPlayerCombatWitness.cjs");
