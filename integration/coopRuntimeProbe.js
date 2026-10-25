"use strict";
// Repo-test shim: integration/*.cjs call require("./coopRuntimeProbe") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopRuntimeProbe.cjs to Code/server/src/space/coopRuntimeProbe.js, so this file is never shipped.
module.exports = require("./coopRuntimeProbe.cjs");
