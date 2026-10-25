"use strict";
// Repo-test shim: integration/*.cjs call require("./coopVirtualWorld") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopVirtualWorld.cjs to Code/server/src/space/coopVirtualWorld.js, so this file is never shipped.
module.exports = require("./coopVirtualWorld.cjs");
