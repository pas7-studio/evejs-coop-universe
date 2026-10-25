"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNpcLossBridge") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNpcLossBridge.cjs to Code/server/src/space/coopNpcLossBridge.js, so this file is never shipped.
module.exports = require("./coopNpcLossBridge.cjs");
