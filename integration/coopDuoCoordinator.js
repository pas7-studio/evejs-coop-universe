"use strict";
// Repo-test shim: integration/*.cjs call require("./coopDuoCoordinator") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopDuoCoordinator.cjs to Code/server/src/space/coopDuoCoordinator.js, so this file is never shipped.
module.exports = require("./coopDuoCoordinator.cjs");
