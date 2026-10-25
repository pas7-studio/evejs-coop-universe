"use strict";
// Repo-test shim: integration/*.cjs call require("./coopAgentDialogue") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopAgentDialogue.cjs to Code/server/src/space/coopAgentDialogue.js, so this file is never shipped.
module.exports = require("./coopAgentDialogue.cjs");
