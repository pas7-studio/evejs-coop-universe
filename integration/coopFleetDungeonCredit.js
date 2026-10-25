"use strict";
// Repo-test shim: integration/*.cjs call require("./coopFleetDungeonCredit") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopFleetDungeonCredit.cjs to Code/server/src/space/coopFleetDungeonCredit.js, so this file is never shipped.
module.exports = require("./coopFleetDungeonCredit.cjs");
