"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNpcAmmoBankAtomic") without an extension,
// and the overlay installs every module as <name>.js in server/src/space.
module.exports = require("./coopNpcAmmoBankAtomic.cjs");
