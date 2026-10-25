"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNativeActivity") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNativeActivity.cjs to Code/server/src/space/coopNativeActivity.js, so this file is never shipped.
module.exports = require("./coopNativeActivity.cjs");
