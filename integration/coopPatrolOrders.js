"use strict";
// Repo-test shim: integration/*.cjs call require("./coopPatrolOrders") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopPatrolOrders.cjs to Code/server/src/space/coopPatrolOrders.js, so this file is never shipped.
module.exports = require("./coopPatrolOrders.cjs");
