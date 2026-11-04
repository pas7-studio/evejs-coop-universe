import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// The client's "Military Campaigns" page (Возможности -> Военные кампании) reads
// eve_public.campaign.api from the local public gateway. Before this the service answered
// every request with a zero-length payload, so the page always said "no campaigns found".
// These tests pin the encoded answers: real progress, no invented reward, and a campaign
// set the client's own filter accepts (mil_camp_season1).
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const servicePath = path.join(forkRoot,
  "Code/server/src/_secondary/express/gatewayServices/campaignGatewayService.js");
const protobuf = require(path.join(forkRoot, "Code/server/node_modules/protobufjs"));
const {
  CAMPAIGN_PROTO_ROOT,
  OBJECTIVE_API_PROTO_ROOT,
  REQUEST_RESPONSE_TYPES,
  createCampaignGatewayService,
} = require(servicePath);

const CAMPAIGN_UUID = Buffer.alloc(16, 0x11);
const OBJECTIVE_UUID = Buffer.alloc(16, 0x22);
const CHARACTER_ID = 140000005;

const snapshot = {
  campaignUuid: CAMPAIGN_UUID,
  objectiveUuid: OBJECTIVE_UUID,
  factionID: 500001,
  militiaCorporationID: 1000180,
  race: "caldari",
  warzoneID: 2,
  titleMessageID: 1042792,
  presentingCharacterID: 3019069,
  icon: "eveicon.caldari_logo",
  uiIndex: 1,
  textures: {
    background: "res:/bg.png",
    ambient: "res:/ambient.png",
    middleground: "res:/mid.png",
    foreground: "res:/fg.png",
    objectiveBackground: "res:/banner.png",
    overviewButtonTexture: "res:/card.png",
  },
  targetProgress: 309,
  currentProgress: 283,
  contestedSystems: 21,
  contributorCount: 0,
  startMs: Date.UTC(2026, 10, 1),
  expiryMs: Date.UTC(2026, 10, 8),
  etag: 283000,
};

const MESSAGE_IDS = Object.freeze({
  subtitle: 526628,
  goal: 232528,
  success: 508635,
  failure: 543396,
  objectiveTitle: 232500,
  objectiveSubtitle: 543396,
  methodTitle: 232500,
});

function createFakeView({campaigns = [snapshot]} = {}) {
  const participation = new Map();
  const find = (uuid) => campaigns.find(
    (entry) => Buffer.from(uuid || Buffer.alloc(0)).equals(entry.campaignUuid)) || null;
  const findObjective = (uuid) => campaigns.find(
    (entry) => Buffer.from(uuid || Buffer.alloc(0)).equals(entry.objectiveUuid)) || null;
  return {
    MESSAGE_IDS,
    CAMPAIGN_SET: "mil_camp_season1",
    CONTRIBUTION_METHOD: "warzone_control",
    DEFINITION_VERSION: {major: 1, minor: 0, patch: 0},
    snapshots: () => campaigns,
    campaignByUuid: (uuid) => find(uuid),
    objectiveByUuid: (uuid) => findObjective(uuid),
    participantState: (uuid, characterID) => participation.get(`${uuid.toString("hex")}:${characterID}`) || 0,
    commit: ({objectiveUuid, characterID}) => {
      if (!findObjective(objectiveUuid)) return {status: "UNKNOWN_OBJECTIVE"};
      participation.set(`${objectiveUuid.toString("hex")}:${characterID}`, 1);
      return {status: "APPLIED"};
    },
    resign: ({objectiveUuid, characterID}) => {
      if (!findObjective(objectiveUuid)) return {status: "UNKNOWN_OBJECTIVE"};
      participation.set(`${objectiveUuid.toString("hex")}:${characterID}`, 2);
      return {status: "APPLIED"};
    },
  };
}

function envelope(payload = Buffer.alloc(0)) {
  return {
    payload: {value: payload},
    authoritative_context: {identity: {character: {sequential: CHARACTER_ID}}},
  };
}

const service = createCampaignGatewayService({fwCampaignView: createFakeView()});

function decode(responseTypeName, buffer) {
  const root = responseTypeName.includes(".objective.api.") || responseTypeName.includes(".definition.api.")
    ? OBJECTIVE_API_PROTO_ROOT
    : CAMPAIGN_PROTO_ROOT;
  const type = root.lookupType(responseTypeName);
  return type.toObject(type.decode(buffer), {longs: Number, defaults: false});
}

const getRequest = (campaign) => Buffer.from(
  CAMPAIGN_PROTO_ROOT.lookupType("eve_public.campaign.api.GetRequest")
    .encode(CAMPAIGN_PROTO_ROOT.lookupType("eve_public.campaign.api.GetRequest")
      .create({campaign: {uuid: campaign}, no_version: true})).finish(),
);

test("every campaign request type is answered with its own response type", () => {
  for (const [requestType, responseType] of Object.entries(REQUEST_RESPONSE_TYPES)) {
    const result = service.handleRequest(requestType, envelope(getRequest(CAMPAIGN_UUID)));
    assert.ok(result, requestType);
    assert.equal(result.responseTypeName, responseType, requestType);
  }
});

test("GetAll lists the live campaigns as campaign identifiers", () => {
  const result = service.handleRequest("eve_public.campaign.api.GetAllRequest", envelope());
  assert.equal(result.statusCode, 200);
  const body = decode(result.responseTypeName, result.responsePayloadBuffer);
  assert.equal(body.campaigns.length, 1);
  assert.deepEqual(Buffer.from(body.campaigns[0].uuid), CAMPAIGN_UUID);
});

test("Get describes the campaign in the set the client actually renders", () => {
  const result = service.handleRequest(
    "eve_public.campaign.api.GetRequest", envelope(getRequest(CAMPAIGN_UUID)));
  assert.equal(result.statusCode, 200);
  const body = decode(result.responseTypeName, result.responsePayloadBuffer);
  const attributes = body.attributes;
  assert.equal(attributes.title.sequential, 1042792, "faction title message id");
  assert.equal(attributes.subtitle.sequential, MESSAGE_IDS.subtitle);
  assert.equal(attributes.state, 1, "STATE_ACTIVE");
  assert.equal(attributes.not_finished, true);
  assert.equal(attributes.target_progress, 309);
  assert.equal(attributes.issuer.faction.sequential, 500001);
  const annotations = Object.fromEntries(attributes.annotations.map((a) => [a.key, a.value]));
  assert.equal(annotations.campaign_set, "mil_camp_season1",
    "the client filters cards by this set name");
  assert.equal(annotations.ui_idx, "1");

  assert.equal(body.available_objectives.length, 1);
  const objective = body.available_objectives[0];
  assert.deepEqual(Buffer.from(objective.objective.uuid), OBJECTIVE_UUID);
  assert.equal(objective.attributes.state, 1);
  assert.equal(objective.attributes.career, 3, "CAREER_ENFORCER - the client maps only real careers");
  assert.equal(objective.attributes.target_progress, 309);
  assert.equal(objective.attributes.rewards.no_isk_reward, true);
  assert.equal(objective.attributes.rewards.no_lp_reward, true);
  assert.equal(objective.attributes.rewards.no_standing_reward, true);
  assert.equal(objective.attributes.rewards.isk_reward, undefined, "nothing is minted");
});

// The client resolves every content tag id through
// metadata.common.content_tags.content_tags_data.get_content_tag(), which returns
// None for an id it does not ship. The campaign card then holds
// ContentTag(id, None) and Job.career_tag -> ContentTag.tag_type raises
//   AttributeError: 'NoneType' object has no attribute 'contentTagType'
// inside CampaignJobCard._construct_title_icons (measured 2026-11-04 12:06:50 on
// character 140000005: the whole card aborted, so the tile was dark and empty).
// This is the exact id list of the client's ContentTags enum.
const CLIENT_CONTENT_TAGS = new Set([
  "activity_combat", "activity_donation", "activity_fleet",
  "activity_gas_harvesting", "activity_hacking", "activity_hauling",
  "activity_ice_harvesting", "activity_logistics", "activity_manufacturing",
  "activity_mining", "activity_salvaging", "activity_trading", "activity_travel",
  "career_path_enforcer", "career_path_explorer", "career_path_industrialist",
  "career_path_soldier_of_fortune",
  "feature_acp", "feature_agent_missions", "feature_capsuleer_day",
  "feature_combat_anomalies", "feature_corporation_projects",
  "feature_cosmic_anomalies", "feature_cosmic_signatures", "feature_daily_goals",
  "feature_dungeons", "feature_epic_arcs", "feature_escalation_dungeon",
  "feature_ess", "feature_factional_warfare", "feature_freelance_projects",
  "feature_homefront_operations", "feature_ice_belts", "feature_introductions",
  "feature_landmarks", "feature_mercenary_tactical_ops", "feature_ore_anomalies",
  "feature_paragon_missions", "feature_pirate_insurgencies",
  "feature_sansha_incursions", "feature_seasons", "feature_triglavian",
  "feature_winter_nexus", "feature_world_events", "feature_campaigns",
]);

test("every served objective content tag exists in the client's ContentTags enum", () => {
  const result = service.handleRequest(
    "eve_public.campaign.api.GetRequest", envelope(getRequest(CAMPAIGN_UUID)));
  const body = decode(result.responseTypeName, result.responsePayloadBuffer);
  const tags = body.available_objectives[0].attributes.content_tags
    .map((tag) => tag.name);
  assert.ok(tags.includes("feature_campaigns"), "the campaigns provider filters on this");
  assert.ok(tags.includes("career_path_enforcer"), "the card's title icon needs a career tag");
  for (const tag of tags) {
    assert.ok(CLIENT_CONTENT_TAGS.has(tag), `unknown content tag ${tag}`);
  }
});

test("the objective carries a real presenting character, not id 0", () => {
  const result = service.handleRequest(
    "eve_public.campaign.api.GetRequest", envelope(getRequest(CAMPAIGN_UUID)));
  const body = decode(result.responseTypeName, result.responsePayloadBuffer);
  // Without presenting_character the page prints "Item 0" and a placeholder portrait
  // (measured 2026-11-04); the war view supplies an officer of the militia corporation.
  assert.equal(body.available_objectives[0].attributes.presenting_character.sequential, 3019069);
});

test("stats report the measured warzone progress, not a fabricated number", () => {
  const result = service.handleRequest(
    "eve_public.campaign.api.GetStatsRequest", envelope(getRequest(CAMPAIGN_UUID)));
  const body = decode(result.responseTypeName, result.responsePayloadBuffer);
  assert.equal(body.campaign_stats.current_campaign_progress, 283);
  assert.equal(body.objective_stats[0].stats.current_objective_progress, 283);
  assert.equal(body.objective_stats[0].stats.total_contributors, 0);
});

test("commit and resign move the pilot's own participation state", () => {
  const commit = service.handleRequest(
    "eve_public.campaign.objective.api.CommitRequest",
    envelope(Buffer.from(OBJECTIVE_API_PROTO_ROOT
      .lookupType("eve_public.campaign.objective.api.CommitRequest")
      .encode(OBJECTIVE_API_PROTO_ROOT
        .lookupType("eve_public.campaign.objective.api.CommitRequest")
        .create({objective: {uuid: OBJECTIVE_UUID}})).finish())),
  );
  assert.equal(commit.statusCode, 200);
  const committed = decode(
    "eve_public.campaign.api.GetParticipantStatsResponse",
    service.handleRequest("eve_public.campaign.api.GetParticipantStatsRequest",
      envelope(getRequest(CAMPAIGN_UUID))).responsePayloadBuffer,
  );
  assert.equal(committed.participant_stats[0].stats.state, 1, "PARTICIPANT_STATE_COMMITTED");

  service.handleRequest(
    "eve_public.campaign.objective.api.ResignRequest",
    envelope(Buffer.from(OBJECTIVE_API_PROTO_ROOT
      .lookupType("eve_public.campaign.objective.api.ResignRequest")
      .encode(OBJECTIVE_API_PROTO_ROOT
        .lookupType("eve_public.campaign.objective.api.ResignRequest")
        .create({objective: {uuid: OBJECTIVE_UUID}})).finish())),
  );
  const resigned = decode(
    "eve_public.campaign.api.GetParticipantStatsResponse",
    service.handleRequest("eve_public.campaign.api.GetParticipantStatsRequest",
      envelope(getRequest(CAMPAIGN_UUID))).responsePayloadBuffer,
  );
  assert.equal(resigned.participant_stats[0].stats.state, 2, "PARTICIPANT_STATE_RESIGNED");
});

test("an unknown campaign is NOT_FOUND, never an empty definition", () => {
  const result = service.handleRequest(
    "eve_public.campaign.api.GetRequest", envelope(getRequest(Buffer.alloc(16, 0x33))));
  assert.equal(result.statusCode, 5, "gRPC NOT_FOUND");
  assert.match(result.statusMessage, /campaign not found/);
});

test("with no live war the answer stays the stock empty payload", () => {
  const empty = createCampaignGatewayService({fwCampaignView: createFakeView({campaigns: []})});
  const result = empty.handleRequest("eve_public.campaign.api.GetAllRequest", envelope());
  assert.equal(result.statusCode, 200);
  assert.equal(result.responsePayloadBuffer.length, 0);
  assert.equal(result.responseTypeName, "eve_public.campaign.api.GetAllResponse");
});

test("the campaign view keeps stable ids across restarts", (t) => {
  let view;
  try {
    view = require(path.join(forkRoot, "Code/server/src/space/coopFactionWarCampaignView.js"));
  } catch (error) {
    t.skip(`campaign view needs the server runtime: ${error.message}`);
    return;
  }
  assert.equal(view.campaignUuid(500001).toString("hex"), view.campaignUuid(500001).toString("hex"));
  assert.notEqual(view.campaignUuid(500001).toString("hex"), view.campaignUuid(500004).toString("hex"));
  assert.equal(view.campaignUuid(500001).length, 16);
  assert.equal(view.campaignUuid(500001)[6] & 0xf0, 0x50, "RFC 4122 version 5 nibble");
});
