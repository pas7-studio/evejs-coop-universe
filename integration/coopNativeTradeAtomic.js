"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNativeTradeAtomic") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNativeTradeAtomic.cjs to Code/server/src/space/coopNativeTradeAtomic.js, so this file is never shipped.
module.exports = require("./coopNativeTradeAtomic.cjs");
