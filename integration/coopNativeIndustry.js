"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNativeIndustry") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNativeIndustry.cjs to Code/server/src/space/coopNativeIndustry.js, so this file is never shipped.
module.exports = require("./coopNativeIndustry.cjs");
