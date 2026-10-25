"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNativeCombatEvidence") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNativeCombatEvidence.cjs to Code/server/src/space/coopNativeCombatEvidence.js, so this file is never shipped.
module.exports = require("./coopNativeCombatEvidence.cjs");
