"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNativeTradeCustody") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNativeTradeCustody.cjs to Code/server/src/space/coopNativeTradeCustody.js, so this file is never shipped.
module.exports = require("./coopNativeTradeCustody.cjs");
