import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";

// The local gRPC gateway listens on TLS + HTTP/2 inside the express secondary. Two things in
// that file are load-bearing and were learned the hard way:
//
//  1. Node's compat layer (an Http2ServerResponse) engages for every stream as soon as a
//     "request" listener exists on the HTTP/2 server, and that response then sends its own
//     trailers after the gateway already sent grpc-status. Measured live:
//     ERR_HTTP2_TRAILERS_ALREADY_SENT thrown from ServerHttp2Stream.onStreamTrailersReady,
//     inside an internal handler, which killed the whole server process.
//  2. express.json() must not touch binary bodies: it answered the client's gRPC frames with
//     an HTML 500 that the client cannot decode (ServerException(500, "invalid character on
//     request") on licences, insurgency, corp goals and campaigns).
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const serverSource = () => readFileSync(
  path.join(forkRoot, "Code/server/src/_secondary/express/server.js"), "utf8");

test("the HTTP/2 gateway listener stays out of Node's request/response compat layer", () => {
  const source = serverSource();
  assert.doesNotMatch(source, /secureServer\.on\("request"/,
    "a request listener on the HTTP/2 server makes every stream use the compat response, " +
    "which sends its own trailers and crashes on ERR_HTTP2_TRAILERS_ALREADY_SENT");
  assert.match(source, /secureServer\.on\("stream"/);
  assert.match(source, /handleSecureStream\(stream, headers\)/,
    "the stream handler is extracted so it can be wrapped");
  assert.match(source, /stream handler error/,
    "a throw inside the stream handler must be logged, not kill the process");
});

test("only JSON bodies are parsed as JSON on the plain-HTTP port", () => {
  const source = serverSource();
  assert.match(source, /contentType\.includes\("application\/json"\)/,
    "express.json() must be gated by content type, or a binary gRPC body becomes an HTML 500");
});

test("a gateway call that lands on the plain-HTTP port is logged, not silently echoed", () => {
  const source = serverSource();
  assert.match(source, /gateway request on the plain-HTTP port/,
    "an empty tab is otherwise indistinguishable from a client that never used the launcher proxy");
});

test("the unhandled-method fallbacks only warn when the method really is missing", () => {
  // essMgr/DynamicResourceCacheMgr answer null for a system with no ESS; the old code called
  // that an "Unhandled method fallback" on every login and pointed at the wrong thing.
  const source = readFileSync(path.join(forkRoot,
    "Code/server/src/services/dynamic/essMgrService.js"), "utf8");
  assert.match(source, /const handled = typeof this\[`Handle_\$\{method\}`\] === "function"/);
  const cache = readFileSync(path.join(forkRoot,
    "Code/server/src/services/dynamic/dynamicResourceCacheMgrService.js"), "utf8");
  assert.match(cache, /const handled = typeof this\[`Handle_\$\{method\}`\] === "function"/);
});
