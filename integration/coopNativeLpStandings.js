"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNativeLpStandings") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNativeLpStandings.cjs to Code/server/src/space/coopNativeLpStandings.js, so this file is never shipped.
module.exports = require("./coopNativeLpStandings.cjs");
