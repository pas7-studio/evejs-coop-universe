"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNpcTactics") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNpcTactics.cjs to Code/server/src/space/coopNpcTactics.js, so this file is never shipped.
module.exports = require("./coopNpcTactics.cjs");
