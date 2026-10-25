"use strict";
// Repo-test shim: integration/*.cjs call require("./coopVirtualEconomy") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopVirtualEconomy.cjs to Code/server/src/space/coopVirtualEconomy.js, so this file is never shipped.
module.exports = require("./coopVirtualEconomy.cjs");
