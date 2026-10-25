"use strict";
// Repo-test shim: integration/*.cjs call require("./coopPatrolNavigator") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopPatrolNavigator.cjs to Code/server/src/space/coopPatrolNavigator.js, so this file is never shipped.
module.exports = require("./coopPatrolNavigator.cjs");
