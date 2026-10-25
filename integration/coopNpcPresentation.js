"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNpcPresentation") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNpcPresentation.cjs to Code/server/src/space/coopNpcPresentation.js, so this file is never shipped.
module.exports = require("./coopNpcPresentation.cjs");
