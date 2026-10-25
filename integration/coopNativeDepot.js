"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNativeDepot") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNativeDepot.cjs to Code/server/src/space/coopNativeDepot.js, so this file is never shipped.
module.exports = require("./coopNativeDepot.cjs");
