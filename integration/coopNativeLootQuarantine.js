"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNativeLootQuarantine") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNativeLootQuarantine.cjs to Code/server/src/space/coopNativeLootQuarantine.js, so this file is never shipped.
module.exports = require("./coopNativeLootQuarantine.cjs");
