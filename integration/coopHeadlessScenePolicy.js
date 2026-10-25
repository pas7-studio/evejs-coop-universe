"use strict";
// Repo-test shim: integration/*.cjs call require("./coopHeadlessScenePolicy") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopHeadlessScenePolicy.cjs to Code/server/src/space/coopHeadlessScenePolicy.js, so this file is never shipped.
module.exports = require("./coopHeadlessScenePolicy.cjs");
