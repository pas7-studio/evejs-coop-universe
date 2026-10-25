"use strict";
// Repo-test shim: integration/*.cjs call require("./coopFleetWarpArrival") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopFleetWarpArrival.cjs to Code/server/src/space/coopFleetWarpArrival.js, so this file is never shipped.
module.exports = require("./coopFleetWarpArrival.cjs");
