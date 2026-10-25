"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNativeFleetParty") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNativeFleetParty.cjs to Code/server/src/space/coopNativeFleetParty.js, so this file is never shipped.
module.exports = require("./coopNativeFleetParty.cjs");
