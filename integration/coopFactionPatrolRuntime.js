"use strict";
// Repo-test shim: integration/*.cjs call require("./coopFactionPatrolRuntime") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopFactionPatrolRuntime.cjs to Code/server/src/space/coopFactionPatrolRuntime.js, so this file is never shipped.
module.exports = require("./coopFactionPatrolRuntime.cjs");
