"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNativeNpcDemo") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNativeNpcDemo.cjs to Code/server/src/space/coopNativeNpcDemo.js, so this file is never shipped.
module.exports = require("./coopNativeNpcDemo.cjs");
