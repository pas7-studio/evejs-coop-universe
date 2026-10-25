"use strict";
// Repo-test shim: integration/*.cjs call require("./coopFactionDirector") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopFactionDirector.cjs to Code/server/src/space/coopFactionDirector.js, so this file is never shipped.
module.exports = require("./coopFactionDirector.cjs");
