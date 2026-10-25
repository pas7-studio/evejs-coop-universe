"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNpcLife") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNpcLife.cjs to Code/server/src/space/coopNpcLife.js, so this file is never shipped.
module.exports = require("./coopNpcLife.cjs");
