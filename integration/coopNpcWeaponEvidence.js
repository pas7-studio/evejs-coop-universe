"use strict";
// Repo-test shim: integration/*.cjs call require("./coopNpcWeaponEvidence") without an extension.
// Node's CJS resolver never tries .cjs, so this stub forwards to the real module.
// Deployment copies only coopNpcWeaponEvidence.cjs to Code/server/src/space/coopNpcWeaponEvidence.js, so this file is never shipped.
module.exports = require("./coopNpcWeaponEvidence.cjs");
