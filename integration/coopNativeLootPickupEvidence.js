"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNativeLootPickupEvidence") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNativeLootPickupEvidence.cjs to Code/server/src/space/coopNativeLootPickupEvidence.js, so this file is never shipped.
module.exports = require("./coopNativeLootPickupEvidence.cjs");
