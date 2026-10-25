"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNativeRaidEligibility") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNativeRaidEligibility.cjs to Code/server/src/space/coopNativeRaidEligibility.js, so this file is never shipped.
module.exports = require("./coopNativeRaidEligibility.cjs");
