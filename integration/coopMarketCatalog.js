"use strict";
// Repo-test shim: integration/*.cjs call require("./coopMarketCatalog") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopMarketCatalog.cjs to Code/server/src/space/coopMarketCatalog.js, so this file is never shipped.
module.exports = require("./coopMarketCatalog.cjs");
