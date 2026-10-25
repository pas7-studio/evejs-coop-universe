"use strict";
// Repo-test shim: integration/*.cjs call require("./coopWorldSignals") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopWorldSignals.cjs to Code/server/src/space/coopWorldSignals.js, so this file is never shipped.
module.exports = require("./coopWorldSignals.cjs");
