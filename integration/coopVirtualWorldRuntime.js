"use strict";
// Repo-test shim: integration/*.cjs call require("./coopVirtualWorldRuntime") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopVirtualWorldRuntime.cjs to Code/server/src/space/coopVirtualWorldRuntime.js, so this file is never shipped.
module.exports = require("./coopVirtualWorldRuntime.cjs");
