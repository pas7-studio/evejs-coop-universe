"use strict";
// Repo-test shim: integration/*.cjs call require("./coopStockFleetWreckEvidence") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopStockFleetWreckEvidence.cjs to Code/server/src/space/coopStockFleetWreckEvidence.js, so this file is never shipped.
module.exports = require("./coopStockFleetWreckEvidence.cjs");
