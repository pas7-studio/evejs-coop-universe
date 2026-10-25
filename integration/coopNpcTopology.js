"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNpcTopology") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNpcTopology.cjs to Code/server/src/space/coopNpcTopology.js, so this file is never shipped.
module.exports = require("./coopNpcTopology.cjs");
