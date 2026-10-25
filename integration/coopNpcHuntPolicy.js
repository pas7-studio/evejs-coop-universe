"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNpcHuntPolicy") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNpcHuntPolicy.cjs to Code/server/src/space/coopNpcHuntPolicy.js, so this file is never shipped.
module.exports = require("./coopNpcHuntPolicy.cjs");
