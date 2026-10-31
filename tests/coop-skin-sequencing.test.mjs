import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// SKIN sequencing jobs. A job is the only thing that turns a design into a third-party skin, and
// it pays before it exists: component licences are validated as a whole and then spent, and
// `licenses` is the number of copies the job mints. A due job completes on read, exactly once.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {createSkinSequencing} = require(
  path.join(forkRoot, "Code/server/src/space/coopSkinSequencing.js"));
const {createComponentLicences} = require(
  path.join(forkRoot, "Code/server/src/space/coopComponentLicences.js"));
const {createThirdPartySkins} = require(
  path.join(forkRoot, "Code/server/src/space/coopThirdPartySkins.js"));
const {
  SEQUENCING_PROTO_ROOT,
  createSkinSequencingGatewayService,
} = require(path.join(forkRoot,
  "Code/server/src/_secondary/express/gatewayServices/skinSequencingGatewayService.js"));

const JOB_API = "eve_public.cosmetic.ship.skin.thirdparty.sequencing.job.api";
const START = Date.UTC(2026, 9, 29, 19, 0, 0);
const LAYOUT = Buffer.from("0a06080112020802120408d18901", "hex");

function fakeCharacterState(initial = {}) {
  const records = structuredClone(initial);
  return {
    records,
    getCharacterRecord(id) {
      const row = records[String(id)];
      return row ? structuredClone(row) : null;
    },
    updateCharacterRecord(id, mutate) {
      const next = mutate(structuredClone(records[String(id)] || {characterID: id}));
      records[String(id)] = next;
      return {success: true, data: structuredClone(next)};
    },
  };
}

function world({quantity = 2, capacity = 5} = {}) {
  const state = fakeCharacterState({"7": {characterID: 7}, "8": {characterID: 8}});
  const clock = {now: START};
  const env = {EVEJS_COOP_THIRD_PARTY_SKINS: "1", EVEJS_COOP_SKIN_SEQUENCING_MS: "60000"};
  const componentLicences = createComponentLicences({characterState: state, clock: () => clock.now, env});
  const skins = createThirdPartySkins({characterState: state, clock: () => clock.now, env});
  componentLicences.grantFinite(7, {component: 11, capacity});
  componentLicences.grantInfinite(7, {component: 22});
  let uuidSeed = 0;
  const sequencing = createSkinSequencing({
    characterState: state,
    componentLicences,
    skins,
    clock: () => clock.now,
    randomUuid: () => Buffer.alloc(16, ++uuidSeed),
    env,
  });
  return {state, clock, componentLicences, skins, sequencing, env, quantity};
}

const kinds = () => [
  {component: 11, infinite: false, finite: 2},
  {component: 22, infinite: true, finite: 0},
];

test("a job pays with real component licences before it exists", () => {
  const {sequencing, componentLicences} = world();
  const started = sequencing.initiate(7, {
    name: "Nova", lineName: "L1", layout: LAYOUT.toString("base64"), kinds: kinds(), quantity: 2,
  });
  assert.equal(started.status, "STARTED");
  assert.equal(started.job.pending, true);
  assert.equal(started.job.quantity, 2, "licenses is the number of copies");
  assert.equal(started.job.skinHex, "", "no skin exists before the job completes");
  assert.equal(componentLicences.finite(7, 11).capacity, 3, "the finite licence was spent by 2");
  assert.deepEqual(sequencing.list(7).map((job) => job.uuid), [started.job.uuid]);
});

test("a design that cannot be paid for spends nothing at all", () => {
  const {sequencing, componentLicences} = world({capacity: 1});
  const tooExpensive = sequencing.initiate(7, {
    name: "Nova", layout: LAYOUT.toString("base64"), kinds: kinds(), quantity: 1,
  });
  assert.equal(tooExpensive.status, "NOT_ENOUGH_CAPACITY");
  assert.equal(componentLicences.finite(7, 11).capacity, 1, "the first component was not spent");

  const unknown = sequencing.initiate(7, {
    name: "Nova",
    layout: LAYOUT.toString("base64"),
    kinds: kinds(),
    quantity: 1,
  });
  assert.equal(unknown.status, "NOT_ENOUGH_CAPACITY");

  // an infinite-only design is free
  const free = sequencing.initiate(7, {
    name: "Free", layout: LAYOUT.toString("base64"), kinds: [{component: 22, infinite: true}], quantity: 1,
  });
  assert.equal(free.status, "STARTED");

  assert.equal(sequencing.initiate(7, {name: "x", kinds: kinds(), quantity: 1}).status,
    "LAYOUT_REQUIRED");
  assert.equal(sequencing.initiate(7, {name: "x", layout: "aa", kinds: kinds(), quantity: 0}).status,
    "QUANTITY_INVALID");
  assert.equal(sequencing.initiate(7, {
    name: "x", layout: "aa", kinds: [{component: 999}], quantity: 1,
  }).status, "LICENCE_NOT_FOUND");
});

test("a due job completes on read and mints exactly its copies, once", () => {
  const {sequencing, skins, clock} = world();
  const job = sequencing.initiate(7, {
    name: "Nova", layout: LAYOUT.toString("base64"), kinds: [{component: 22, infinite: true}],
    quantity: 3,
  }).job;

  assert.deepEqual(sequencing.list(7).length, 1);
  clock.now = START + 60001;
  const completed = sequencing.get(7, job.uuid);
  assert.equal(completed.pending, false, "a due job completes on read");
  assert.equal(completed.completedMs, clock.now);
  assert.match(completed.skinHex, /^[0-9a-f]{16}$/);
  assert.deepEqual(sequencing.list(7), [], "a completed job is not active");

  const licence = skins.get(7, completed.skinHex);
  assert.equal(licence.unactivated, 3, "the job minted its quantity");
  assert.equal(licence.activated, false, "copies arrive unactivated, as a grant does");

  // reading it again must not mint again
  sequencing.get(7, job.uuid);
  assert.equal(skins.get(7, completed.skinHex).unactivated, 3);
  assert.equal(sequencing.get(8, job.uuid), null, "a job id is not shared across characters");
  assert.equal(sequencing.completeEarly(7, job.uuid).status, "NOT_PENDING");
});

test("CompleteEarly finishes a pending job now", () => {
  const {sequencing, skins, clock} = world();
  const job = sequencing.initiate(7, {
    name: "Early", layout: LAYOUT.toString("base64"), kinds: [{component: 22, infinite: true}],
    quantity: 1,
  }).job;
  const result = sequencing.completeEarly(7, job.uuid);
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.job.completedMs, clock.now);
  assert.equal(skins.get(7, result.job.skinHex).unactivated, 1);
  assert.equal(sequencing.completeEarly(7, "00ff").status, "NOT_FOUND");
  assert.equal(sequencing.completeEarly(7, "").status, "UUID_REQUIRED");
});

test("starting a job publishes StartedNotice to the character that started it", () => {
  const {sequencing} = world();
  const published = [];
  const service = createSkinSequencingGatewayService({
    skinSequencing: sequencing,
    publishGatewayNotice(typeName, payload, target) {
      published.push({typeName, payload, target});
    },
  });
  const encode = (name, value) =>
    Buffer.from(SEQUENCING_PROTO_ROOT.lookupType(name).encode(value).finish());
  const payload = Buffer.concat([
    encode(`${JOB_API}.InitiateRequest`, {
      name: "Nova",
      licenses: 1,
      component_licenses: [{component: {coating: {sequential: 11}}, finite: 1}],
    }),
    Buffer.from([0x1a, LAYOUT.length]), LAYOUT,
  ]);
  const started = service.handleRequest(`${JOB_API}.InitiateRequest`, {
    payload: {value: payload},
    authoritative_context: {identity: {character: {sequential: 7}}},
  });
  assert.equal(started.statusCode, 200, started.statusMessage);

  assert.equal(published.length, 1, "the job window learns about the job it just started");
  assert.equal(published[0].typeName, `${JOB_API}.StartedNotice`);
  assert.deepEqual(published[0].target, {character: 7});
  const notice = SEQUENCING_PROTO_ROOT.lookupType(`${JOB_API}.StartedNotice`)
    .decode(published[0].payload);
  const body = SEQUENCING_PROTO_ROOT.lookupType(`${JOB_API}.InitiateResponse`)
    .decode(started.responsePayloadBuffer);
  assert.deepEqual([...notice.id.uuid], [...body.id.uuid], "the same job id the answer carries");
});

test("the gateway answers a started job with a real id and honest refusals", () => {
  const {sequencing, componentLicences, clock, skins} = world();
  const service = createSkinSequencingGatewayService({skinSequencing: sequencing});
  const encode = (name, value) =>
    Buffer.from(SEQUENCING_PROTO_ROOT.lookupType(name).encode(value).finish());
  const decode = (name, buffer) =>
    SEQUENCING_PROTO_ROOT.lookupType(name).decode(buffer || Buffer.alloc(0));
  const envelope = (value, characterID = 7) => ({
    payload: {value: value || Buffer.alloc(0)},
    authoritative_context: {identity: {character: {sequential: characterID}}},
  });

  const payload = Buffer.concat([
    encode(`${JOB_API}.InitiateRequest`, {
      name: "Nova",
      licenses: 2,
      component_licenses: [
        {component: {coating: {sequential: 11}}, finite: 2},
        {component: {coating: {sequential: 22}}, infinite: true},
      ],
    }),
    Buffer.from([0x1a, LAYOUT.length]), LAYOUT,
  ]);
  const started = service.handleRequest(`${JOB_API}.InitiateRequest`, envelope(payload));
  assert.equal(started.statusCode, 200, started.statusMessage);
  const body = decode(`${JOB_API}.InitiateResponse`, started.responsePayloadBuffer);
  assert.equal(body.id.uuid.length, 16);
  assert.equal(body.attributes.pending, true);
  assert.equal(Number(body.attributes.quantity), 2);
  assert.ok(body.attributes.planned_completion.seconds > body.attributes.started.seconds);
  assert.equal(componentLicences.finite(7, 11).capacity, 3, "the finite licence was spent by 2");

  const active = decode(`${JOB_API}.GetAllActiveResponse`,
    service.handleRequest(`${JOB_API}.GetAllActiveRequest`, envelope()).responsePayloadBuffer);
  assert.equal(active.jobs.length, 1);

  const refusals = [
    [`${JOB_API}.InitiateRequest`, envelope(encode(`${JOB_API}.InitiateRequest`, {name: "no design"})), 3],
    [`${JOB_API}.GetRequest`, envelope(encode(`${JOB_API}.GetRequest`, {job: {uuid: Buffer.alloc(16, 9)}})), 5],
  ];
  for (const [typeName, request, expected] of refusals) {
    const result = service.handleRequest(typeName, request);
    assert.equal(result.statusCode, expected, typeName);
  }

  clock.now += 60001;
  const read = service.handleRequest(`${JOB_API}.GetRequest`, envelope(
    encode(`${JOB_API}.GetRequest`, {job: {uuid: body.id.uuid}})));
  assert.equal(read.statusCode, 200);
  const readBody = decode(`${JOB_API}.GetResponse`, read.responsePayloadBuffer);
  assert.equal(readBody.job.pending, false);
  assert.equal(readBody.job.skin.hex, sequencing.get(7, body.id.uuid).skinHex);
  assert.equal(skins.get(7, readBody.job.skin.hex).unactivated, 2);
  assert.equal(readBody.job.sequencer.sequential, 7);

  const again = service.handleRequest(`${JOB_API}.CompleteEarlyRequest`, envelope(
    encode(`${JOB_API}.CompleteEarlyRequest`, {job: {uuid: body.id.uuid}})));
  assert.equal(again.statusCode, 9, "a finished job cannot be completed again");
});
