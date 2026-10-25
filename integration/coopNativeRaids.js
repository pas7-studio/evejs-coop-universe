"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNativeRaids") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNativeRaids.cjs to Code/server/src/space/coopNativeRaids.js, so this file is never shipped.
module.exports = require("./coopNativeRaids.cjs");
