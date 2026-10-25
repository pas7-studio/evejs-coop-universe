"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNativeConvoyRenewal") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNativeConvoyRenewal.cjs to Code/server/src/space/coopNativeConvoyRenewal.js, so this file is never shipped.
module.exports = require("./coopNativeConvoyRenewal.cjs");
