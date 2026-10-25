"use strict";
// Repo-test shim: integration/*.cjs call require("./coopDuoRaidTactics") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopDuoRaidTactics.cjs to Code/server/src/space/coopDuoRaidTactics.js, so this file is never shipped.
module.exports = require("./coopDuoRaidTactics.cjs");
