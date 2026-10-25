"use strict";
// Repo-test shim: integration/*.cjs call require("./coopIndustryPacing") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopIndustryPacing.cjs to Code/server/src/space/coopIndustryPacing.js, so this file is never shipped.
module.exports = require("./coopIndustryPacing.cjs");
