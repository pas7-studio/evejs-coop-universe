"use strict";
// Minimal, dependency-free MCP server over stdio (newline-delimited JSON-RPC).
// Deliberately small: we only need initialize, tools/list, tools/call and ping.
// Every tool is a plain function, so tests can drive it without a live client.
const readline = require("node:readline");
const { spawnSync } = require("node:child_process");

const PROTOCOL_VERSION = "2024-11-05";

function execArgv(argv, { timeoutMs = 60000, input, maxBuffer = 8 * 1024 * 1024, cwd } = {}) {
  if (!Array.isArray(argv) || !argv.length) throw new Error("execArgv needs an argument vector");
  const result = spawnSync(argv[0], argv.slice(1), {
    encoding: "utf8",
    timeout: timeoutMs,
    input,
    cwd,
    windowsHide: true,
    maxBuffer,
  });
  if (result.error) {
    return { ok: false, code: null, stdout: "", stderr: String(result.error.message || result.error) };
  }
  return {
    ok: result.status === 0,
    code: result.status,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
  };
}

function cap(text, limit = 12000) {
  const value = String(text == null ? "" : text);
  if (value.length <= limit) return value;
  return value.slice(0, limit) + `\n... [truncated ${value.length - limit} chars]`;
}

function asText(value) {
  if (typeof value === "string") return { content: [{ type: "text", text: cap(value) }] };
  return { content: [{ type: "text", text: cap(JSON.stringify(value, null, 2)) }] };
}

function asError(message, detail) {
  const text = detail ? `${message}\n${detail}` : String(message);
  return { content: [{ type: "text", text: cap(text) }], isError: true };
}

function checkSchema(schema, args) {
  if (!schema) return null;
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (args[key] === undefined || args[key] === null) return `missing required argument: ${key}`;
  }
  const properties = schema.properties || {};
  for (const [key, value] of Object.entries(args)) {
    const spec = properties[key];
    if (!spec) continue;
    const type = spec.type;
    if (type === "string" && typeof value !== "string") return `${key} must be a string`;
    if (type === "integer" && !Number.isInteger(value)) return `${key} must be an integer`;
    if (type === "number" && typeof value !== "number") return `${key} must be a number`;
    if (type === "boolean" && typeof value !== "boolean") return `${key} must be a boolean`;
    if (type === "string" && spec.enum && !spec.enum.includes(value)) {
      return `${key} must be one of: ${spec.enum.join(", ")}`;
    }
    if (typeof spec.maxLength === "number" && typeof value === "string" && value.length > spec.maxLength) {
      return `${key} is longer than ${spec.maxLength} characters`;
    }
  }
  return null;
}

function createServer({ name, version = "1.0.0", instructions = "", tools = [] }) {
  if (!name) throw new Error("server name is required");
  const byName = new Map();
  for (const tool of tools) {
    if (!tool || !tool.name || typeof tool.handler !== "function") {
      throw new Error("every tool needs a name and a handler");
    }
    if (byName.has(tool.name)) throw new Error(`duplicate tool: ${tool.name}`);
    byName.set(tool.name, tool);
  }

  function listTools() {
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description || "",
        inputSchema: tool.inputSchema || { type: "object", properties: {} },
        annotations: tool.annotations || {
          readOnlyHint: !tool.mutating,
          destructiveHint: Boolean(tool.mutating),
        },
      })),
    };
  }

  async function callTool(params) {
    const toolName = params && params.name;
    const tool = byName.get(toolName);
    if (!tool) return asError(`unknown tool: ${toolName}`);
    const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
    const invalid = checkSchema(tool.inputSchema, args);
    if (invalid) return asError(`invalid arguments for ${toolName}: ${invalid}`);
    try {
      return asText(await tool.handler(args));
    } catch (error) {
      return asError(`${toolName} failed: ${error && error.message ? error.message : error}`);
    }
  }

  async function handle(message) {
    if (!message || typeof message !== "object") return null;
    const { id, method } = message;
    const isRequest = id !== undefined && id !== null;
    switch (method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name, version },
            instructions,
          },
        };
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return { jsonrpc: "2.0", id, result: listTools() };
      case "tools/call": {
        const result = await callTool(message.params || {});
        return { jsonrpc: "2.0", id, result };
      }
      default:
        if (!isRequest) return null;
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `method not found: ${method}` },
        };
    }
  }

  function serve(input = process.stdin, output = process.stdout) {
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    rl.on("line", async (line) => {
      const text = line.trim();
      if (!text) return;
      let message;
      try {
        message = JSON.parse(text);
      } catch {
        output.write(JSON.stringify({
          jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" },
        }) + "\n");
        return;
      }
      let response = null;
      try {
        response = await handle(message);
      } catch (error) {
        if (message && message.id !== undefined) {
          response = {
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32603, message: String(error && error.message ? error.message : error) },
          };
        }
      }
      if (response) output.write(JSON.stringify(response) + "\n");
    });
    return rl;
  }

  return { name, version, tools, listTools, callTool, handle, serve, toolNames: [...byName.keys()] };
}

module.exports = { createServer, execArgv, cap, asText, asError, checkSchema, PROTOCOL_VERSION };
