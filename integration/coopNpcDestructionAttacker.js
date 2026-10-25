"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNpcDestructionAttacker") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNpcDestructionAttacker.cjs to Code/server/src/space/coopNpcDestructionAttacker.js, so this file is never shipped.
module.exports = require("./coopNpcDestructionAttacker.cjs");
