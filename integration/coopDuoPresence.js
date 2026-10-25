"use strict";
// Repo-test shim: integration/*.cjs call require("./coopDuoPresence") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopDuoPresence.cjs to Code/server/src/space/coopDuoPresence.js, so this file is never shipped.
module.exports = require("./coopDuoPresence.cjs");
