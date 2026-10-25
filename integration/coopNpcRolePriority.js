"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNpcRolePriority") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNpcRolePriority.cjs to Code/server/src/space/coopNpcRolePriority.js, so this file is never shipped.
module.exports = require("./coopNpcRolePriority.cjs");
