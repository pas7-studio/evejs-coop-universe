"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNpcMaterializer") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNpcMaterializer.cjs to Code/server/src/space/coopNpcMaterializer.js, so this file is never shipped.
module.exports = require("./coopNpcMaterializer.cjs");
