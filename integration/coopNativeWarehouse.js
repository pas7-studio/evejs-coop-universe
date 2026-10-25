"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNativeWarehouse") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNativeWarehouse.cjs to Code/server/src/space/coopNativeWarehouse.js, so this file is never shipped.
module.exports = require("./coopNativeWarehouse.cjs");
