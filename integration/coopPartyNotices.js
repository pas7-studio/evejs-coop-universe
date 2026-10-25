"use strict";
// Repo-test shim: integration/*.cjs call require("./coopPartyNotices") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopPartyNotices.cjs to Code/server/src/space/coopPartyNotices.js, so this file is never shipped.
module.exports = require("./coopPartyNotices.cjs");
