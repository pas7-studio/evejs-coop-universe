"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNativeNpcMarket") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNativeNpcMarket.cjs to Code/server/src/space/coopNativeNpcMarket.js, so this file is never shipped.
module.exports = require("./coopNativeNpcMarket.cjs");
