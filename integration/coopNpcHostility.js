"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNpcHostility") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNpcHostility.cjs to Code/server/src/space/coopNpcHostility.js, so this file is never shipped.
module.exports = require("./coopNpcHostility.cjs");
