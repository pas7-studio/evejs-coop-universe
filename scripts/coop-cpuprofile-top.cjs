"use strict";
// Top self-time functions from a V8 .cpuprofile. Self time = the samples attributed to a
// node itself, so this answers "where does the process actually spend CPU" without guessing.
const fs = require("fs");
const file = process.argv[2];
const raw = fs.readFileSync(file, "utf8");
const profile = JSON.parse(raw);
const nodesById = new Map();
for (const node of profile.nodes || []) nodesById.set(node.id, node);
const selfMicros = new Map();
const samples = profile.samples || [];
const deltas = profile.timeDeltas || [];
for (let i = 0; i < samples.length; i += 1) {
  const id = samples[i];
  const delta = Number(deltas[i]) || 0;
  selfMicros.set(id, (selfMicros.get(id) || 0) + delta);
}
const rows = [];
let totalMicros = 0;
for (const [id, micros] of selfMicros.entries()) {
  const node = nodesById.get(id) || {};
  const frame = node.callFrame || {};
  totalMicros += micros;
  rows.push({
    micros,
    functionName: String(frame.functionName || "(anonymous)"),
    url: String(frame.url || "").replace(/^file:\/\/\/app\/server\//, ""),
    line: frame.lineNumber,
  });
}
rows.sort((left, right) => right.micros - left.micros);
const totalSeconds = totalMicros / 1e6;
console.log("file:", file, "| samples:", samples.length, "| profiled seconds:", totalSeconds.toFixed(1));
for (const row of rows.slice(0, 28)) {
  const pct = totalMicros > 0 ? (row.micros / totalMicros) * 100 : 0;
  console.log(`${pct.toFixed(2).padStart(6)}%  ${(row.micros / 1e6).toFixed(2).padStart(8)}s  ${row.functionName}  ${row.url}:${row.line}`);
}
// Group by file, which is what tells "one hot function" from "one heavy module".
const byFile = new Map();
for (const row of rows) {
  const key = row.url || "(native)";
  byFile.set(key, (byFile.get(key) || 0) + row.micros);
}
console.log("--- by file ---");
for (const [url, micros] of [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`${((micros / totalMicros) * 100).toFixed(2).padStart(6)}%  ${(micros / 1e6).toFixed(2).padStart(8)}s  ${url}`);
}
