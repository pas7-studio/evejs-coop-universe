"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNativeMiningReadiness") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNativeMiningReadiness.cjs to Code/server/src/space/coopNativeMiningReadiness.js, so this file is never shipped.
module.exports = require("./coopNativeMiningReadiness.cjs");
