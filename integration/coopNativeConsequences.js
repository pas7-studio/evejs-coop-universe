"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNativeConsequences") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNativeConsequences.cjs to Code/server/src/space/coopNativeConsequences.js, so this file is never shipped.
module.exports = require("./coopNativeConsequences.cjs");
