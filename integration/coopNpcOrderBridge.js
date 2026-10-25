"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNpcOrderBridge") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNpcOrderBridge.cjs to Code/server/src/space/coopNpcOrderBridge.js, so this file is never shipped.
module.exports = require("./coopNpcOrderBridge.cjs");
