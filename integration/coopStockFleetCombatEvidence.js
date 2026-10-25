"use strict";
// Repo-test shim: integration/*.cjs call require("./coopStockFleetCombatEvidence") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopStockFleetCombatEvidence.cjs to Code/server/src/space/coopStockFleetCombatEvidence.js, so this file is never shipped.
module.exports = require("./coopStockFleetCombatEvidence.cjs");
