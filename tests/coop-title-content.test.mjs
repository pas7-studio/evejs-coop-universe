import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import zlib from "node:zlib";
import path from "node:path";

// Our own title catalogue. The client downloads this flatbuffer over HTTPS, verifies its CRC and
// parses it as `TitleData { titles: [Title { id: uuid hex, localized_name }] }` with the file
// identifier 'CHTI'. The test reads the buffer the same way the client does, because a wrong
// offset here shows up in game as a title with no name.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const contentPath = path.join(forkRoot, "Code/server/src/space/coopTitleContent.js");
const {TITLES, buildTitleData, content, crc32} = require(contentPath);
const {
  TITLE_DEFINITION_PROTO_ROOT,
  createTitleDefinitionGatewayService,
} = require(path.join(forkRoot,
  "Code/server/src/_secondary/express/gatewayServices/characterTitleDefinitionGatewayService.js"));

const API = "eve_public.cosmetic.character.title.definition.api";

// --- the client's reader, in miniature -------------------------------------
function readTitleData(buffer) {
  const rootOffset = buffer.readUInt32LE(0);
  const identifier = buffer.toString("utf8", 4, 8);
  const table = rootOffset;
  const vtable = table - buffer.readInt32LE(table);
  const vtableSize = buffer.readUInt16LE(vtable);
  assert.ok(vtableSize >= 4, "the table has a vtable");
  const field0 = buffer.readUInt16LE(vtable + 4);
  const titles = [];
  if (field0 !== 0) {
    const vectorAt = table + field0 + buffer.readUInt32LE(table + field0);
    const count = buffer.readUInt32LE(vectorAt);
    for (let index = 0; index < count; index += 1) {
      const elementAt = vectorAt + 4 + index * 4;
      const titleAt = elementAt + buffer.readUInt32LE(elementAt);
      const titleVtable = titleAt - buffer.readInt32LE(titleAt);
      const readString = (fieldIndex) => {
        const offset = buffer.readUInt16LE(titleVtable + 4 + fieldIndex * 2);
        if (offset === 0) return "";
        const at = titleAt + offset + buffer.readUInt32LE(titleAt + offset);
        const length = buffer.readUInt32LE(at);
        return buffer.toString("utf8", at + 4, at + 4 + length);
      };
      titles.push({id: readString(0), name: readString(1)});
    }
  }
  return {identifier, titles};
}

test("the catalogue parses the way the client parses it", () => {
  const buffer = buildTitleData();
  const parsed = readTitleData(buffer);
  assert.equal(parsed.identifier, "CHTI", "the client checks this identifier");
  assert.equal(parsed.titles.length, TITLES.length);
  assert.deepEqual(parsed.titles.map((entry) => entry.id), TITLES.map((entry) => entry.id));
  assert.deepEqual(parsed.titles.map((entry) => entry.name), TITLES.map((entry) => entry.name));
  for (const title of parsed.titles) {
    assert.match(title.id, /^[0-9a-f]{32}$/, "uuid.UUID(<string>) needs a hex uuid");
    assert.ok(title.name.length > 0, "a title without a name is invisible in the window");
  }
});

test("the checkpoint describes exactly the bytes served, CRC included", () => {
  const served = content();
  const expected = typeof zlib.crc32 === "function" ? zlib.crc32(served.buffer) >>> 0 : null;
  assert.equal(served.crc, crc32(served.buffer));
  if (expected !== null) assert.equal(served.crc, expected, "the client compares this CRC");
  assert.match(served.url, /^https:\/\/[^/]+\/.*\.titles$/,
    "the client opens HTTPSConnection(host, 443) and GETs the path");
  assert.equal(served.path, served.url.replace(/^https:\/\/[^/]+/, ""));

  const service = createTitleDefinitionGatewayService({titleContent: served});
  const result = service.handleRequest(`${API}.GetLatestRequest`, {
    payload: {value: Buffer.alloc(0)},
    authoritative_context: {identity: {character: {sequential: 7}}},
  });
  assert.equal(result.statusCode, 200);
  const body = TITLE_DEFINITION_PROTO_ROOT.lookupType(`${API}.GetLatestResponse`)
    .decode(result.responsePayloadBuffer);
  assert.equal(body.checkpoint.url, served.url);
  assert.equal(body.checkpoint.crc.crc, served.crc);
  assert.equal(body.checkpoint.version.major, 1);
});

test("the CDN route serves our file and nothing else", () => {
  const {getTitleContentAsset} = require(contentPath);
  const asset = getTitleContentAsset(content().path);
  assert.ok(asset, "the route the checkpoint advertises must be served");
  assert.equal(asset.buffer.length, content().buffer.length);
  assert.equal(getTitleContentAsset("/elysian-eve/other"), null);
  assert.equal(getTitleContentAsset("/"), null);
});

// A plain HTTP/1.1 content host: the client's flatbuffer provider is Python 2 httplib, so it
// needs a GET answered on port 443, while that port is the HTTP/2 gateway.
const {createContentRequestHandler, parseBind} = require(
  path.join(forkRoot, "Code/server/src/_secondary/express/contentCdnServer.js"));

function fakeResponse() {
  const out = {status: 0, headers: null, body: null};
  return {
    out,
    writeHead(status, headers) {
      out.status = status;
      out.headers = headers;
    },
    end(body) {
      out.body = body;
    },
  };
}

test("the content host serves only the routes it publishes", () => {
  const resolveAsset = (routePath) => (routePath === "/elysian-eve/titles/1.0.0.titles"
    ? {buffer: Buffer.from("abc"), contentType: "application/octet-stream"}
    : null);
  const handler = createContentRequestHandler(resolveAsset);

  const hit = fakeResponse();
  handler({method: "GET", url: "/elysian-eve/titles/1.0.0.titles"}, hit);
  assert.equal(hit.out.status, 200);
  assert.equal(hit.out.headers["content-length"], 3);
  assert.deepEqual(hit.out.body, Buffer.from("abc"));

  const miss = fakeResponse();
  handler({method: "GET", url: "/eve_public.cosmetic.ship.skin.thirdparty.api.GetRequest"}, miss);
  assert.equal(miss.out.status, 404, "it is a content host, not a second gateway");

  const post = fakeResponse();
  handler({method: "POST", url: "/elysian-eve/titles/1.0.0.titles"}, post);
  assert.equal(post.out.status, 404, "only GET serves content");
});

test("a bind address is parsed strictly, never guessed", () => {
  assert.deepEqual(parseBind("127.0.0.2:443"), {host: "127.0.0.2", port: 443});
  assert.deepEqual(parseBind("8443"), {host: "127.0.0.1", port: 8443});
  assert.deepEqual(parseBind(""), null);
  assert.deepEqual(parseBind("nope"), null);
  assert.deepEqual(parseBind("127.0.0.2:0"), null);
});
