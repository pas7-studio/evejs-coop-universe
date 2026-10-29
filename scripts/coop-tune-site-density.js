"use strict";
// Raise the high-sec site density to something close to the real game, then let the engine's own
// seeder/rotation handle the rest.
//
// Sources (see docs/UNIVERSE_SITE_DENSITY.md): players report ~3 combat anomalies as the norm in a
// high-sec system; cleared sites respawn somewhere in the region within seconds to minutes (the server
// batches respawns every ~10 s), and neglected sites are what pile up in quiet systems. Our profiles had
// 1 slot on 360 of ~1200 high-sec systems with a 24 h lifetime, i.e. most systems empty and sticky.
//
// This edits the DUNGEON_AUTHORITY static data (gameStore), not code: slotsPerSystem per band, every
// visited system eligible (ratio 1), and a shorter lifetime so sites rotate.
const fs = require("node:fs");
const path = require("node:path");

const FILE = process.env.DUNGEON_AUTHORITY_FILE ||
  "/var/lib/evejs/gameStore/data/dungeonAuthority/data.json";
const BACKUP = `${FILE}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;

const TARGETS = {
  // family: { highsec slots, lowsec, nullsec, wormhole, lifetimeMinutes }
  combat_anomaly: { highsec: 3, lowsec: 3, nullsec: 4, wormhole: 3, lifetime: 360 },
  combat: { highsec: 2, lowsec: 2, nullsec: 2, wormhole: 2, lifetime: 360 },
  data: { highsec: 2, lowsec: 2, nullsec: 2, wormhole: 2, lifetime: 480 },
  relic: { highsec: 2, lowsec: 2, nullsec: 2, wormhole: 2, lifetime: 480 },
  gas: { highsec: 1, lowsec: 1, nullsec: 1, wormhole: 2, lifetime: 480 },
};

const doc = JSON.parse(fs.readFileSync(FILE, "utf8"));
const families = doc && doc.spawnProfiles && doc.spawnProfiles.families;
if (!families) {
  console.log("NO_SPAWN_PROFILES");
  process.exit(2);
}
fs.writeFileSync(BACKUP, JSON.stringify(doc, null, 1));
console.log(`BACKUP ${BACKUP}`);

const changed = [];
for (const [family, target] of Object.entries(TARGETS)) {
  const profile = families[family];
  if (!profile) {
    console.log(`SKIP ${family} (no profile)`);
    continue;
  }
  const bands = profile.bands || {};
  for (const band of ["highsec", "lowsec", "nullsec", "wormhole"]) {
    const bandProfile = bands[band];
    if (!bandProfile || !(Number(bandProfile.slotsPerSystem) > 0)) continue;
    bandProfile.slotsPerSystem = target[band];
    bandProfile.targetSystems = 0;
    bandProfile.targetSystemRatio = 1;
    bandProfile.systemStride = Math.max(1, Number(bandProfile.systemStride) || 1);
  }
  profile.siteLifetimeMinutes = target.lifetime;
  changed.push(`${family}: slots hs/ls/ns/wh=${target.highsec}/${target.lowsec}/${target.nullsec}/${target.wormhole} lifetime=${target.lifetime}min`);
}
fs.writeFileSync(FILE, JSON.stringify(doc, null, 1));
for (const line of changed) console.log(`CHANGED ${line}`);
console.log(`WROTE ${FILE}`);
