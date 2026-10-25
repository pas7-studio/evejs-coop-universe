"use strict";
// Repo-test shim: integration/*.cjs call require("./coopFleetTradeSafety") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopFleetTradeSafety.cjs to Code/server/src/space/coopFleetTradeSafety.js, so this file is never shipped.
module.exports = require("./coopFleetTradeSafety.cjs");
