"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNativeScanProof") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNativeScanProof.cjs to Code/server/src/space/coopNativeScanProof.js, so this file is never shipped.
module.exports = require("./coopNativeScanProof.cjs");
