"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNpcGateTravel") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNpcGateTravel.cjs to Code/server/src/space/coopNpcGateTravel.js, so this file is never shipped.
module.exports = require("./coopNpcGateTravel.cjs");
