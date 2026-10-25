"use strict";
// Repo-test shim: integration/*.cjs call require("./coopFleetWarpSafety") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopFleetWarpSafety.cjs to Code/server/src/space/coopFleetWarpSafety.js, so this file is never shipped.
module.exports = require("./coopFleetWarpSafety.cjs");
