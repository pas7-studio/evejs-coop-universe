"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNativeHaulCargo") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNativeHaulCargo.cjs to Code/server/src/space/coopNativeHaulCargo.js, so this file is never shipped.
module.exports = require("./coopNativeHaulCargo.cjs");
