import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const { createClientTools, decode } = require("../mcp/lib/clientTools.cjs");

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), "eve-client-mcp-"));
  const settings = join(root, "AppData", "Local", "CCP", "EVE", "w_eve_online_-_1_tq_127.0.0.1", "settings");
  const chatlogs = join(root, "Documents", "EVE", "logs", "Chatlogs");
  const gamelogs = join(root, "Documents", "EVE", "logs", "Gamelogs");
  mkdirSync(settings, { recursive: true });
  mkdirSync(chatlogs, { recursive: true });
  mkdirSync(gamelogs, { recursive: true });
  writeFileSync(join(settings, "core_char_140000005.dat"), "x");
  writeFileSync(join(settings, "core_user_3.dat"), "<color=0xFF00FF00>/ Brackets: Combat</color>");
  writeFileSync(join(gamelogs, "20261025_120000.txt"), "EVE Client 23.01\nConnected to 127.0.0.1\n");
  writeFileSync(join(chatlogs, "Local_20261025_120000_140000005.txt"),
    Buffer.concat([Buffer.from("[ 2026.10.25 12:00:00 ] Rook Vale > "), Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]), Buffer.from("\r\n")]));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, settings, chatlogs };
}

const notRunning = () => ({ ok: true, code: 0, stdout: "INFO: No tasks are running which match the specified criteria.\r\n", stderr: "" });
const running = () => ({ ok: true, code: 0, stdout: '"exefile.exe","4242","Console","1","400,000 K"\r\n', stderr: "" });

function build(root, exec = notRunning) {
  const tools = createClientTools({
    env: { USERPROFILE: root, LOCALAPPDATA: join(root, "AppData", "Local") },
    exec,
    clock: () => 1_700_000_000_000,
  }).tools;
  return { tools, call: (name, args = {}) => tools.find((tool) => tool.name === name).handler(args) };
}

test("status proves the client's own footprint, and stays honest when it is closed", async (t) => {
  const { root } = workspace(t);
  const { call } = build(root);
  const open = await call("client_status");
  assert.match(open, /client process: not running/);
  assert.match(open, /character files: 1 \(140000005\)/);
  assert.match(open, /gamelog: 20261025_120000\.txt/);
  const runningNow = await build(root, running).call("client_status");
  assert.match(runningNow, /client process: running \(pid 4242\)/);
});

test("chat logs are decoded even when the client wrote windows-1251", async (t) => {
  const { root } = workspace(t);
  const { call } = build(root);
  const chat = await call("client_chat", { channel: "Local", lines: 10 });
  assert.match(chat, /Rook Vale > Привет/);
  assert.equal(decode(Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2])), "Привет");
});

test("console reads the newest gamelog and filters it", async (t) => {
  const { root } = workspace(t);
  const { call } = build(root);
  assert.match(await call("client_console", { lines: 5 }), /EVE Client/);
  assert.match(await call("client_console", { grep: "connected" }), /Connected to 127\.0\.0\.1/);
  assert.match(await call("client_console", { grep: "nothing-here" }), /^file: .*\n$/);
});

test("tab rename refuses a length change, refuses while the client runs, and backs up on success", async (t) => {
  const { root, settings } = workspace(t);
  const file = join(settings, "core_user_3.dat");
  const open = build(root);
  assert.match(await open.call("overview_rename_tab", { from: "/ Brackets: Combat", to: "Бой", confirm: true }), /refused: .*bytes/);
  assert.match(await build(root, running).call("overview_rename_tab", { from: "/ Brackets: Combat", to: "/ Brackets: Combat!", confirm: false }), /refused/);
  assert.match(await build(root, running).call("overview_rename_tab", { from: "/ Brackets: Combat", to: "/ Brackets: Battle", confirm: true }), /client is running/);
  const ok = await open.call("overview_rename_tab", { from: "/ Brackets: Combat", to: "/ Brackets: Battle", confirm: true });
  assert.match(ok, /renamed 1 occurrence/);
  assert.match(readFileSync(file, "utf8"), /\/ Brackets: Battle/);
  assert.equal(readFileSync(file, "utf8").length, "<color=0xFF00FF00>/ Brackets: Battle</color>".length);
  assert.ok(readdirSync(settings).some((name) => name.includes(".bak-")));
});

test("profile install only accepts a real exported overview and never overwrites the live client", async (t) => {
  const { root } = workspace(t);
  const { call } = build(root);
  const bogus = join(root, "bogus.yaml");
  writeFileSync(bogus, "hello: world\n");
  await assert.rejects(() => call("install_profile", { source: bogus }), /presets\/tabSetup missing/);
  const good = join(root, "good.yaml");
  writeFileSync(good, "columnOrder: []\npresets:\n- []\ntabSetup:\n- []\n");
  const done = await call("install_profile", { source: good, name: "alife.yaml" });
  assert.match(done, /installed/);
  assert.match(readFileSync(join(root, "Documents", "EVE", "Overview", "alife.yaml"), "utf8"), /tabSetup/);
});
