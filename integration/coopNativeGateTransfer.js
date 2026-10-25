"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNativeGateTransfer") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNativeGateTransfer.cjs to Code/server/src/space/coopNativeGateTransfer.js, so this file is never shipped.
module.exports = require("./coopNativeGateTransfer.cjs");
