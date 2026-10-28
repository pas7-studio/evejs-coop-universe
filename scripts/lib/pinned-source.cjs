"use strict";
// Shared read-only checks for the pinned-original-source verifiers.
//
// Why this file exists: five scripts/verify-*.cjs each re-implemented the same
// three things and drifted while doing it - a Git blob hash of the CRLF-canonical
// text, a forward/reverse chain of in-memory patches that must be idempotent and
// byte-reversible in both line endings, and the `node script.cjs <root>` CLI.
// One of them (verify-alife08) had to export its private hash so verify-alife09
// could reuse it, which is why the extraction lives here instead of in a verifier.
//
// Nothing here writes to disk or requires a game module: a wrong tree is a
// throw/exit, never a partial apply. Failure texts stay owned by the caller,
// because the gate scripts and the docs quote them.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// The hash Git itself would store for this text: `blob <bytes>\0` over LF bytes.
// A Windows checkout of the same commit differs only by CRLF, so canonicalise.
function gitBlobSha(text) {
  const canonical = String(text).replace(/\r\n/g, "\n");
  const raw = Buffer.from(canonical, "utf8");
  return crypto.createHash("sha1").update(Buffer.from("blob " + raw.length + "\0")).update(raw).digest("hex");
}

// Read a pinned file and report the hash Git would store for it. The caller
// compares and owns the message: the gate scripts quote each verifier's text.
// Returns the disk text untouched (that is what a patch is given) plus the
// canonical text the hash was taken from.
function readPinned(root, relPath) {
  const file = path.join(path.resolve(root), relPath);
  const original = fs.readFileSync(file, "utf8");
  const canonical = original.replace(/\r\n/g, "\n");
  return { file, original, canonical, sha: gitBlobSha(canonical) };
}

// Prove that a chain of in-memory patches, applied to real pinned text, is
// idempotent at its last stage and byte-reversible in every declared variant.
// stages: [{name, apply(text), revert(text)}] applied in order, reverted in
// reverse order; variants: [{mode, text}] (LF and CRLF, or the disk text).
// Every failure message is the caller's, so an operator still sees the string
// the gate documents.
function assertReversible({ variants, stages, checkSyntax, failure }) {
  if (!stages.length) throw Error("PINNED_SOURCE_NO_STAGES");
  const last = stages[stages.length - 1];
  for (const variant of variants) {
    const before = variant.text;
    let current = before;
    let previous = before;
    for (const stage of stages) {
      previous = current;
      current = stage.apply(current);
    }
    if (checkSyntax) checkSyntax(current, variant.mode);
    // The last stage must change the text and be idempotent, then the whole
    // chain must give back exactly the bytes it started from.
    if (current === previous || last.apply(current) !== current) throw Error(failure(variant.mode));
    for (const stage of [...stages].reverse()) current = stage.revert(current);
    if (current !== before) throw Error(failure(variant.mode));
  }
  return variants.map((variant) => variant.mode);
}

// `node scripts/verify-*.cjs <pinned-code-root>`: exit 2 without an argument,
// 1 when the tree does not match, 0 with the JSON report on stdout.
function runVerifier({ verify, usage, resolve = true, errorPrefix = "", errorExitCode = 1, isSuccess = null }) {
  const input = process.argv[2];
  if (!input) {
    console.error(usage);
    process.exitCode = 2;
    return;
  }
  try {
    const report = verify(resolve ? path.resolve(input) : input);
    console.log(JSON.stringify(report, null, 2));
    if (isSuccess && !isSuccess(report)) process.exitCode = 1;
  } catch (error) {
    console.error(errorPrefix + String((error && error.message) || error));
    process.exitCode = errorExitCode;
  }
}

module.exports = { gitBlobSha, readPinned, assertReversible, runVerifier };
