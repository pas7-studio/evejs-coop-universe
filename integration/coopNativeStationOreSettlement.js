"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNativeStationOreSettlement") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNativeStationOreSettlement.cjs to Code/server/src/space/coopNativeStationOreSettlement.js, so this file is never shipped.
module.exports = require("./coopNativeStationOreSettlement.cjs");
