"use strict";
// Repo-test shim: integration/*.cjs call require("./coopSystemIntel") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopSystemIntel.cjs to Code/server/src/space/coopSystemIntel.js, so this file is never shipped.
module.exports = require("./coopSystemIntel.cjs");
