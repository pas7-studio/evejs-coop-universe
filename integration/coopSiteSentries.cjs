"use strict";
// Which real gun stands behind a site battery.
//
// Measured 2026-11-04 on the running stack, in this order:
//  1. The batteries a client sees inside a site ("Light/Heavy/Cruise Missile Battery") are
//     category 23 scenery: hit points only, no weapon attributes at all, and materialised
//     as static content - no controller, so they can never fire.
//  2. Category 11 "Destructible Sentry Gun" batteries (e.g. "Guristas Heavy Missile
//     Battery" 17598) also carry zero damage attributes in this build: their damage lives
//     in a missile charge the data does not name, and their rate-of-fire attribute reads
//     20 000 000 ms.
//  3. The faction's own SENTRY GUN - "<Faction> Sentry Gun" - does carry a complete,
//     usable weapon profile, and every one of them has a native NPC profile too:
//       13114 Angel Sentry Gun        em 1 / exp 4 / kin 4 / th 1, x1.25, 2 500 ms
//       13116 Blood Raider Sentry Gun em 4 / exp 1 / kin 1 / th 4, x8,    8 000 ms
//       13068 Guristas Sentry Gun     em 1 / exp 1 / kin 4 / th 4, x1.25, 2 500 ms
//       13113 Sansha Sentry Gun       em 4 / exp 1 / kin 1 / th 4, x1.25, 2 500 ms
//       13115 Serpentis Sentry Gun    em 1 / exp 1 / kin 4 / th 4, x1.25, 2 500 ms
//       1194 Amarr Sentry Gun         em16 / exp16 / kin28 / th28, x5,   2 500 ms
//     (the empire sentry guns exist as "Sentry Gun" profiles without the destructible
//     prefix, so the caller resolves by name, not by a hard-coded profile id).
//
// So the decision is: a site battery is defended by its faction's real sentry gun. This
// module only names the type; both the spawn and the firing read that type's own
// attributes, so nothing here invents damage, a cycle or a range.
const FACTION_KEYWORDS = [
  ["guristas", "Guristas"],
  ["sansha", "Sansha"],
  ["blood", "Blood Raider"],
  ["serpentis", "Serpentis"],
  ["angel", "Angel"],
  ["rogue", "Rogue Drone"],
  ["amarr", "Amarr"],
  ["caldari", "Caldari"],
  ["gallente", "Gallente"],
  ["minmatar", "Minmatar"],
  ["ammatar", "Ammatar"],
  ["khanid", "Khanid"],
];

// Factions whose sentry gun type does not exist in this build; the caller must skip them
// rather than invent a hull. Measured 2026-11-05 against the item registry.
const NO_SENTRY_GUN = Object.freeze(["Rogue Drone", "Caldari", "Ammatar", "Khanid"]);

function factionFromQuery(query) {
  const text = String(query || "").trim().toLowerCase();
  if (!text) return "";
  for (const [keyword, faction] of FACTION_KEYWORDS) {
    if (text.includes(keyword)) return faction;
  }
  return "";
}

// Only a structure that really is a battery/sentry can be defended by a sentry gun; the
// rest of the site content (cargo rigs, acceleration gates, towers) keeps whatever the
// stock materialiser gave it.
function isBatteryName(structureName) {
  return /battery|sentry/i.test(String(structureName || ""));
}

function pickFiringTypeName({structureName, spawnQuery} = {}) {
  if (!isBatteryName(structureName)) return "";
  const faction = factionFromQuery(spawnQuery);
  if (!faction || NO_SENTRY_GUN.includes(faction)) return "";
  return `${faction} Sentry Gun`;
}

module.exports = {
  FACTION_KEYWORDS,
  NO_SENTRY_GUN,
  factionFromQuery,
  isBatteryName,
  pickFiringTypeName,
};
