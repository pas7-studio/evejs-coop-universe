"use strict";
// Repo-test shim: integration/*.cjs call require("./coopIdentityRegistry") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopIdentityRegistry.cjs to Code/server/src/space/coopIdentityRegistry.js, so this file is never shipped.
module.exports = require("./coopIdentityRegistry.cjs");
