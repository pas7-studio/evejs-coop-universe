"use strict";
// Fetches the NPC agent portraits declared by the bundled manifest into
// generated/Character, which is exactly where the image server looks
// (portraitImageStore.getCharacterPortraitFilePath -> <id>_<size>.jpg).
//
// The upstream checkout ships only generated/agents/manifest.json; the image
// files themselves are not in git, so a fresh install serves the hi.jpg
// placeholder for every agent. This script rebuilds that cache. It is
// resumable: existing files are skipped, so it can be stopped and restarted.
//
// Run inside the server container (it has node, curl and network):
//   docker cp scripts/fetch-agent-portraits.cjs evejs-server-1:/tmp/fetch.cjs
//   docker exec evejs-server-1 node /tmp/fetch.cjs --sizes 256 --concurrency 8
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
function opt(name, fallback) {
  const index = args.indexOf("--" + name);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
}

const manifestPath = opt("manifest", "/app/server/src/_secondary/image/generated/agents/manifest.json");
const outDir = opt("out", "/app/server/src/_secondary/image/generated/Character");
const sizes = String(opt("sizes", "256")).split(",").map((value) => Number(value)).filter(Number.isFinite);
const concurrency = Math.max(1, Number(opt("concurrency", "8")));
const limit = Math.max(0, Number(opt("limit", "0")));

if (!fs.existsSync(manifestPath)) {
  console.error("missing manifest: " + manifestPath);
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const wanted = Object.values(manifest.portraits || {})
  .filter((entry) => sizes.includes(Number(entry.size)))
  .map((entry) => ({
    id: Number(entry.agentID),
    size: Number(entry.size),
    url: String(entry.sourceUrl || `https://images.evetech.net/characters/${entry.agentID}/portrait?size=${entry.size}`),
    file: path.join(outDir, `${Number(entry.agentID)}_${Number(entry.size)}.jpg`),
  }))
  .filter((entry) => entry.id > 0 && !fs.existsSync(entry.file));

const queue = limit > 0 ? wanted.slice(0, limit) : wanted;
console.log(`manifest entries ${Object.keys(manifest.portraits || {}).length}, sizes [${sizes}], missing ${wanted.length}, this run ${queue.length}`);

let done = 0;
let saved = 0;
let failed = 0;
let cursor = 0;

async function worker() {
  while (cursor < queue.length) {
    const job = queue[cursor++];
    try {
      const response = await fetch(job.url, { headers: { "user-agent": "evejs-coop-portrait-fetch" } });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 256) throw new Error("suspiciously small " + bytes.length);
      fs.writeFileSync(job.file, bytes);
      saved += 1;
    } catch (error) {
      failed += 1;
      if (failed <= 10) console.warn(`FAIL ${job.id}_${job.size}: ${error.message}`);
    }
    done += 1;
    if (done % 500 === 0) console.log(`progress ${done}/${queue.length} saved ${saved} failed ${failed}`);
  }
}

(async () => {
  const started = Date.now();
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  console.log(`finished ${done} saved ${saved} failed ${failed} in ${Math.round((Date.now() - started) / 1000)}s`);
  console.log(`files now in ${outDir}: ${fs.readdirSync(outDir).length}`);
})();
