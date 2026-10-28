"use strict";
// Repo-test shim: integration/*.cjs call require("./coopAlifeStationAuthorityRuntime") without an extension,
// and the overlay installs every module as <name>.js in server/src/space.
module.exports = require("./coopAlifeStationAuthorityRuntime.cjs");
