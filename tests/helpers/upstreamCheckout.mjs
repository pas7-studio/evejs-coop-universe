// Shared guard for the upstream EveJS contract tests.
//
// These tests execute the REAL pinned EveJS modules and therefore need an
// isolated checkout (see scripts/Run-Isolated-Upstream-Tests.cjs). Without
// EVEJS_CODE_PATH they must be SKIPPED: a silent pass would be a false
// contract claim and a hard failure would blame the co-op repo for a missing
// external checkout.
export const upstreamCodePath = String(process.env.EVEJS_CODE_PATH || "").trim();

export const hasUpstreamCodePath = upstreamCodePath.length > 0;

export const upstreamSkipReason = hasUpstreamCodePath
  ? false
  : "requires EVEJS_CODE_PATH; run scripts/Run-Isolated-Upstream-Tests.cjs --code-path <EveJS/Code> -- <files>";

export const upstreamSuiteName =
  "upstream contract suite needs the pinned EveJS checkout (EVEJS_CODE_PATH)";
