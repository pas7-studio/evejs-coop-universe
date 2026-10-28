"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNpcExpeditionCompetition") without an extension,
// and the overlay installs every module as <name>.js in server/src/space.
module.exports = require("./coopNpcExpeditionCompetition.cjs");
