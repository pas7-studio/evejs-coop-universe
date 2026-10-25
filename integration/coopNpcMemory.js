"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNpcMemory") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNpcMemory.cjs to Code/server/src/space/coopNpcMemory.js, so this file is never shipped.
module.exports = require("./coopNpcMemory.cjs");
