"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNpcOpportunityPlanner") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNpcOpportunityPlanner.cjs to Code/server/src/space/coopNpcOpportunityPlanner.js, so this file is never shipped.
module.exports = require("./coopNpcOpportunityPlanner.cjs");
