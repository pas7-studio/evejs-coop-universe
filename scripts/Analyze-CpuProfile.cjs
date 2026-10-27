#!/usr/bin/env node
"use strict";
// Summarise a V8 .cpuprofile by self time, so optimisation targets are measured
// instead of guessed. Usage:
//   node scripts/Analyze-CpuProfile.cjs <file.cpuprofile> [topN]
// Only real profile data is printed; nothing is inferred or filled in.
const fs = require("node:fs");

function main(argv) {
  const file = argv[2];
  const topN = Number(argv[3] || 25);
  if (!file) {
    console.error("usage: node scripts/Analyze-CpuProfile.cjs <file.cpuprofile> [topN]");
    process.exit(2);
  }
  const profile = JSON.parse(fs.readFileSync(file, "utf8"));
  const nodes = new Map();
  for (const n of profile.nodes || []) nodes.set(n.id, n);
  const samples = profile.samples || [];
  const deltas = profile.timeDeltas || [];
  if (!samples.length) {
    console.error("no samples in profile");
    process.exit(3);
  }
  const self = new Map();
  let total = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const dt = deltas[i] || 0;
    total += dt;
    const node = nodes.get(samples[i]);
    if (!node) continue;
    const cf = node.callFrame || {};
    const url = String(cf.url || "").replace(/^file:\/\//, "");
    const key = `${cf.functionName || "(anonymous)"} @ ${url}:${(cf.lineNumber ?? -1) + 1}`;
    self.set(key, (self.get(key) || 0) + dt);
  }
  const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
  const ms = (us) => (us / 1000).toFixed(1);
  console.log(`profile: ${file}`);
  console.log(`samples: ${samples.length}  wall: ${ms(total)} ms  top: ${rows.length}`);
  console.log("");
  console.log("self%  self_ms  function @ file:line");
  for (const [key, us] of rows) {
    const pct = ((us / total) * 100).toFixed(1).padStart(5);
    console.log(`${pct}  ${ms(us).padStart(8)}  ${key}`);
  }
}

main(process.argv);
