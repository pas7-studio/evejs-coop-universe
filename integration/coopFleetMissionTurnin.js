"use strict";
// Repo-test shim: integration/*.cjs call require("./coopFleetMissionTurnin") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopFleetMissionTurnin.cjs to Code/server/src/space/coopFleetMissionTurnin.js, so this file is never shipped.
module.exports = require("./coopFleetMissionTurnin.cjs");
