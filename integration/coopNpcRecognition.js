"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNpcRecognition") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNpcRecognition.cjs to Code/server/src/space/coopNpcRecognition.js, so this file is never shipped.
module.exports = require("./coopNpcRecognition.cjs");
