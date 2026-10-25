"use strict";
// Repo-test shim: integration/*.cjs call require("./coopSessionPresence") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopSessionPresence.cjs to Code/server/src/space/coopSessionPresence.js, so this file is never shipped.
module.exports = require("./coopSessionPresence.cjs");
