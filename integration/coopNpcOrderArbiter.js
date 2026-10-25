"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNpcOrderArbiter") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNpcOrderArbiter.cjs to Code/server/src/space/coopNpcOrderArbiter.js, so this file is never shipped.
module.exports = require("./coopNpcOrderArbiter.cjs");
