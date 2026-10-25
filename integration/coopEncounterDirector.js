"use strict";
// Repo-test shim: integration/*.cjs call require("./coopEncounterDirector") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopEncounterDirector.cjs to Code/server/src/space/coopEncounterDirector.js, so this file is never shipped.
module.exports = require("./coopEncounterDirector.cjs");
