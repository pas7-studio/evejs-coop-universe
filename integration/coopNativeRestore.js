"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNativeRestore") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNativeRestore.cjs to Code/server/src/space/coopNativeRestore.js, so this file is never shipped.
module.exports = require("./coopNativeRestore.cjs");
