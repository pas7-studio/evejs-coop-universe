"use strict";
// Repo-test shim: integration/*.cjs call require("./coopMiningCapacitorGate") without an extension,
// and the overlay installs every module as <name>.js in server/src/space.
module.exports = require("./coopMiningCapacitorGate.cjs");
