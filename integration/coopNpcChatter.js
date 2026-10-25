"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNpcChatter") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNpcChatter.cjs to Code/server/src/space/coopNpcChatter.js, so this file is never shipped.
module.exports = require("./coopNpcChatter.cjs");
