"use strict";
// FW-063: the invariants of a war campaign record, as pure checks.
//
// Every defect this campaign found today was invisible from the outside: a funded war
// whose escrow had silently reverted, a campaign that expired with its money locked, a
// capture with no provenance. Each record looked fine on its own; only the RELATIONS
// between them were wrong. These checks state those relations once, so the CLI, a test
// and any future agent validate the same thing.
//
// A check never guesses: unreadable input is reported as SKIP with the reason, because
// "we could not look" is not "it is wrong".

// FW-066: a WON campaign is terminal for its escrow - no further kill can pay.
const TERMINAL = new Set(["EXPIRED", "CANCELLED", "OCCUPIED"]);
const LIVE = new Set(["PREPARING", "ASSAULT"]);
const KNOWN_STATES = new Set(["PREPARING", "ASSAULT", "OCCUPIED", "CANCELLED", "EXPIRED"]);

function validateCampaignRecord({ state, treasury, fleet, creditedEventIDs = null, presence = null } = {}) {
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });
  const pass = (name, detail) => add(name, "PASS", detail);
  const fail = (name, detail) => add(name, "FAIL", detail);
  const warn = (name, detail) => add(name, "WARN", detail);
  const skip = (name, detail) => add(name, "SKIP", detail);

  if (!state || typeof state !== "object") {
    fail("war-record-readable", "no war state");
    return checks;
  }
  // The record arrives in two shapes: the durable state keys wars/campaigns by id,
  // while the admin projection answers arrays. One normaliser, so a check can never
  // disagree with the world because of the shape it was handed.
  const asArray = (value) => (Array.isArray(value) ? value
    : Object.entries(value || {}).map(([id, row]) => ({ ...row, warID: (row && row.warID) || id,
      campaignID: (row && row.campaignID) || id })));
  const wars = new Map(asArray(state.wars).map((war) => [war.warID, war]));
  const campaigns = asArray(state.campaigns);
  const territories = state.territories || {};
  const reservations = Object.values((treasury || {}).reservations || {});
  const held = reservations.filter((row) => row.status === "HELD");
  const paid = reservations.filter((row) => row.status === "PAID");
  const fundedFor = (campaignID) => reservations.filter((row) =>
    row.campaignID === campaignID && (row.status === "HELD" || row.status === "PAID"));

  pass("war-record-readable", `wars=${wars.size} campaigns=${campaigns.length} ` +
    `territories=${Object.keys(territories).length}`);

  // 1. Every campaign names a war that exists and a state the machine understands.
  const orphans = campaigns.filter((campaign) => !wars.has(campaign.warID)).map((c) => c.campaignID);
  const odd = campaigns.filter((campaign) => !KNOWN_STATES.has(String(campaign.state)))
    .map((c) => `${c.campaignID}:${c.state}`);
  orphans.length || odd.length
    ? fail("campaign-war-state", `orphanWars=${orphans.join(",") || "-"} unknownStates=${odd.join(",") || "-"}`)
    : pass("campaign-war-state", `${campaigns.length} campaigns name a live war and a known state`);

  // 2. A live campaign must be payable by SOMEBODY, or it is a war nobody can win.
  const live = campaigns.filter((campaign) => LIVE.has(String(campaign.state)));
  const unpayable = live.filter((campaign) => fundedFor(campaign.campaignID).length === 0)
    .map((campaign) => campaign.campaignID);
  unpayable.length
    ? fail("campaign-payable", `live campaigns with no escrow at all: ${unpayable.join(", ")}`)
    : pass("campaign-payable", `${live.length} live campaigns have escrow`);

  // 3. Both sides funded is the ideal (FW-046). One side is an explicit per-side
  //    refusal, so it is reported as a warning, never hidden and never fatal.
  const oneSided = [];
  for (const campaign of live) {
    const war = wars.get(campaign.warID);
    if (!war) continue;
    const sides = [war.attackerFactionID, war.defenderFactionID]
      .filter((factionID) => !fundedFor(campaign.campaignID)
        .some((row) => Number(row.factionID) === Number(factionID)));
    if (sides.length) oneSided.push(`${campaign.campaignID}:${sides.join("+")}`);
  }
  oneSided.length
    ? warn("campaign-sides-funded", `sides without escrow: ${oneSided.join(", ")}`)
    : pass("campaign-sides-funded", `${live.length} live campaigns funded on both sides`);

  // 4. Escrow must not stay HELD for a campaign that can never spend it.
  const stranded = held.filter((row) => {
    const campaign = campaigns.find((entry) => entry.campaignID === row.campaignID);
    const war = wars.get(row.warID);
    if (war && war.state === "ENDED") return true;
    return campaign ? TERMINAL.has(String(campaign.state)) : false;
  });
  stranded.length
    ? fail("terminal-escrow-released", `HELD for a terminal campaign: ` +
      `${stranded.map((row) => `${row.campaignID}:${row.factionID}`).join(", ")}`)
    : pass("terminal-escrow-released", `${held.length} HELD rows belong to live campaigns`);

  // 5. A PAID row is a settlement: it must name the pilot and its proof.
  const unproven = paid.filter((row) => !row.paidToPilotID || !row.payoutProofID);
  unproven.length
    ? fail("paid-row-proven", `PAID without pilot or proof: ${unproven.map((r) => r.reservationID).join(", ")}`)
    : pass("paid-row-proven", `${paid.length} PAID rows carry a pilot and a proof`);

  // 6. The second leg: escrow released must also be credited to the pilot (FW-059).
  if (!creditedEventIDs) skip("paid-pilot-credited", "the chest journal is not readable here");
  else {
    const missing = paid.filter((row) => !creditedEventIDs.has(
      `war-bounty:${row.campaignID}:${row.payoutProofID}`));
    missing.length
      ? fail("paid-pilot-credited", `escrow released, pilot not credited: ` +
        `${missing.map((r) => `${r.reservationID}->${r.paidToPilotID}`).join(", ")}`)
      : pass("paid-pilot-credited", `${paid.length} PAID rows have their credit leg`);
  }

  // 7. A system changes hands only through a campaign: START_CAMPAIGN marks it
  //    CONTESTED (+1), CAPTURE_TERRITORY changes the controller (+1). A revision
  //    above 1 with no campaign behind it is a territory nobody fought for.
  const changed = Object.entries(territories).filter(([, row]) => Number(row.revision) > 1);
  const unexplained = changed.filter(([systemID, row]) => {
    const owner = Number(row.militaryControllerFactionID);
    const related = campaigns.filter((campaign) =>
      Number(campaign.targetSystemID) === Number(systemID));
    if (!related.length) return true;
    const captured = related.some((campaign) => campaign.state === "OCCUPIED" &&
      Number((wars.get(campaign.warID) || {}).attackerFactionID) === owner);
    if (row.state === "OCCUPIED") return !captured;
    return !(captured || related.length > 0);
  });
  unexplained.length
    ? fail("territory-provenance", `revision>1 with no campaign behind it: ` +
      `${unexplained.map(([id, row]) => `${id}@r${row.revision}/${row.militaryControllerFactionID}`).join(", ")}`)
    : pass("territory-provenance", `${changed.length} changed systems are named by a campaign`);

  // 8. Two live campaigns must never fight over the same target.
  const byTarget = new Map();
  for (const campaign of live) {
    const key = Number(campaign.targetSystemID);
    byTarget.set(key, [...(byTarget.get(key) || []), campaign.campaignID]);
  }
  const doubled = [...byTarget.entries()].filter(([, ids]) => ids.length > 1);
  doubled.length
    ? fail("one-campaign-per-target", doubled.map(([id, ids]) => `${id}:${ids.join("|")}`).join(", "))
    : pass("one-campaign-per-target", `${byTarget.size} contested target(s), one live campaign each`);

  // 10. A funded side that fields no hull in the theatre can never collect: the
  //     escrow is real, the bounty is real, and no kill of that side can ever happen.
  //     This is the actionable half of "why is there no payout yet".
  const shown = Array.isArray(presence) ? presence : ((state.presence || {}).systems || []);
  if (!shown.length) skip("payout-possible", "no presence in the war record");
  else {
    const starved = [];
    for (const campaign of live) {
      const theatre = [Number(campaign.sourceSystemID), Number(campaign.targetSystemID)];
      for (const row of fundedFor(campaign.campaignID).filter((entry) => entry.status === "HELD")) {
        const present = shown.some((system) => theatre.includes(Number(system.systemID)) &&
          Number((system.factions || {})[row.factionID] || 0) > 0);
        if (!present) starved.push(`${campaign.campaignID}:${row.factionID}`);
      }
    }
    starved.length
      ? warn("payout-possible", `funded but no hull in the theatre: ${starved.join(", ")}`)
      : pass("payout-possible", `every funded side has a hull in its theatre`);
  }

  // 9. A reserved hull must still have an entity and a system to be a hull.
  const ships = fleet ? Object.values(fleet.ships || {}) : null;
  if (!ships) skip("fleet-hulls-present", "no fleet registry row");
  else {
    const ghosts = ships.filter((ship) => !Number(ship.entityID) || !Number(ship.systemID));
    ghosts.length
      ? fail("fleet-hulls-present", `${ghosts.length} registry rows without an entity or system`)
      : pass("fleet-hulls-present", `${ships.length} reserved hulls carry an entity and a system`);
  }

  return checks;
}

function summarise(checks) {
  const count = (status) => checks.filter((row) => row.status === status).length;
  return { total: checks.length, fail: count("FAIL"), warn: count("WARN"),
    skip: count("SKIP"), pass: count("PASS") };
}

module.exports = { validateCampaignRecord, summarise, LIVE, TERMINAL, KNOWN_STATES };
