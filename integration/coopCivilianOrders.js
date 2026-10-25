"use strict";
// Repo-test shim: integration/*.cjs call require("./coopCivilianOrders") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopCivilianOrders.cjs to Code/server/src/space/coopCivilianOrders.js, so this file is never shipped.
module.exports = require("./coopCivilianOrders.cjs");
