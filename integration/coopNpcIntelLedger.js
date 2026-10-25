"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNpcIntelLedger") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNpcIntelLedger.cjs to Code/server/src/space/coopNpcIntelLedger.js, so this file is never shipped.
module.exports = require("./coopNpcIntelLedger.cjs");
