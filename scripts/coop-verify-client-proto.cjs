#!/usr/bin/env node
"use strict";
// Decode bytes our server produced with the CLIENT'S OWN protobuf descriptor.
//
// The generated `*_pb2.pyj` modules in the client archive carry CCP's `serialized_pb`: the real
// FileDescriptorProto for that service. Our own encoder and our own decoder always agree, so a
// wrong field number or a wrong nesting passes every test we write - the same trap the achievement
// flatbuffer fell into. Feeding our bytes to CCP's descriptor is the check that cannot repeat the
// mistake.
//
// CCP's generated modules cannot be imported on a modern protobuf runtime (they use
// `_internal_create_key`), so the descriptor bytes are lifted out of the module's marshal stream
// and rebuilt here. Nothing from the client is written to disk; only the decoded JSON is printed.
//
// Usage: node scripts/coop-verify-client-proto.cjs <message.full.Name> <payload-hex-file|->
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const tempDir = path.join(process.env.TEMP || os.tmpdir(), "opencode", "client-protos");

const SCRIPT = String.raw`
import json, os, sys, zipfile, zlib
from google.protobuf import descriptor_pb2, descriptor_pool, message_factory

ARCHIVE = os.environ.get("EVEJS_CLIENT_CODE_CCP") or r"W:/EVE Online - 3396210/tq/code.ccp"
GENERATED = "eveProto/generated/"
TARGET = sys.argv[1]
HEX_FILE = sys.argv[2]


def marshal_strings(data):
    """Every string constant of a py2.7 marshal stream.

    A serialized FileDescriptorProto is a string constant like any other and it does contain NUL
    bytes, so nothing is filtered here - candidates are validated by parsing them.
    """
    size = len(data)
    for index in range(size - 5):
        if data[index] not in (0x74, 0x73):  # 't' interned, 's' string
            continue
        length = int.from_bytes(data[index + 1:index + 5], "little")
        if not 2 <= length <= 5_000_000 or index + 5 + length > size:
            continue
        yield data[index + 5:index + 5 + length]


def parse_descriptor(chunk):
    """A FileDescriptorProto, or None when the string is not one."""
    if not chunk.startswith(b"\x0a"):
        return None
    try:
        proto = descriptor_pb2.FileDescriptorProto()
        proto.ParseFromString(chunk)
    except Exception:
        return None
    if not proto.name.endswith(".proto") or not proto.package:
        return None
    return proto


modules = {}
with zipfile.ZipFile(ARCHIVE) as archive:
    for info in archive.infolist():
        if not info.filename.endswith((".pyc", ".pyj")):
            continue
        try:
            raw = archive.read(info)
        except Exception:
            continue
        try:
            modules[info.filename] = zlib.decompress(raw)
        except zlib.error:
            modules[info.filename] = raw

package, _, name = TARGET.rpartition(".")

# The file that declares the wanted message, found by its own descriptor rather than by a filename
# guess: message names live in many modules and only one package matches.
file_proto = None
for module_path, data in modules.items():
    if not module_path.startswith(GENERATED):
        continue
    for text in marshal_strings(data):
        proto = parse_descriptor(text)
        if proto is None or proto.package != package:
            continue
        names = set()
        for message in proto.message_type:
            names.add(message.name)
            names.update(nested.name for nested in message.nested_type)
        if name in names:
            file_proto = proto
            break
    if file_proto is not None:
        break

if file_proto is None:
    print(json.dumps({"error": "descriptor not found for " + TARGET}))
    raise SystemExit(3)

pool = descriptor_pool.DescriptorPool()
loaded = set()

WELL_KNOWN = {
    "google/protobuf/any.proto": "google.protobuf.any_pb2",
    "google/protobuf/api.proto": "google.protobuf.api_pb2",
    "google/protobuf/duration.proto": "google.protobuf.duration_pb2",
    "google/protobuf/empty.proto": "google.protobuf.empty_pb2",
    "google/protobuf/field_mask.proto": "google.protobuf.field_mask_pb2",
    "google/protobuf/source_context.proto": "google.protobuf.source_context_pb2",
    "google/protobuf/struct.proto": "google.protobuf.struct_pb2",
    "google/protobuf/timestamp.proto": "google.protobuf.timestamp_pb2",
    "google/protobuf/type.proto": "google.protobuf.type_pb2",
    "google/protobuf/wrappers.proto": "google.protobuf.wrappers_pb2",
}


def load_well_known(name):
    """google/protobuf/* live in the installed runtime, not in the client archive."""
    if name in loaded:
        return
    import importlib
    module = importlib.import_module(WELL_KNOWN[name])
    proto = descriptor_pb2.FileDescriptorProto()
    proto.ParseFromString(module.DESCRIPTOR.serialized_pb)
    loaded.add(name)
    try:
        pool.Add(proto)
    except Exception as error:
        if "duplicate" not in str(error):
            raise


def load(proto):
    if proto.name in loaded:
        return
    for dependency in proto.dependency:
        if dependency.startswith("google/protobuf/"):
            load_well_known(dependency)
            continue
        module_path = GENERATED + dependency[: -len(".proto")] + "_pb2.pyj"
        data = modules.get(module_path)
        if data is None:
            raise SystemExit(json.dumps({"error": "dependency module missing: " + dependency}))
        for text in marshal_strings(data):
            child = parse_descriptor(text)
            if child is not None and child.name == dependency:
                load(child)
                break
    loaded.add(proto.name)
    try:
        pool.Add(proto)
    except Exception as error:
        if "duplicate" not in str(error):
            raise


load(file_proto)
descriptor = pool.FindMessageTypeByName(TARGET)
message = message_factory.GetMessageClass(descriptor)()
text = sys.stdin.read() if HEX_FILE == "-" else open(HEX_FILE, "r", encoding="utf-8").read()
payload = bytes.fromhex("".join(text.split()))
message.ParseFromString(payload)


def plain(value):
    if hasattr(value, "ListFields"):
        out = {}
        for field, item in value.ListFields():
            if field.label == field.LABEL_REPEATED:
                out[field.name] = [plain(element) for element in item]
            else:
                out[field.name] = plain(item)
        return out
    if isinstance(value, bytes):
        return value.decode("utf-8", "backslashreplace")
    return value


print(json.dumps({"descriptor": file_proto.name, "message": TARGET, "value": plain(message)}))
`;

function main() {
  const target = process.argv[2];
  const payloadPath = process.argv[3];
  if (!target || !payloadPath) {
    console.log("USAGE <message.full.Name> <payload-hex-file|->");
    return 2;
  }
  fs.mkdirSync(tempDir, { recursive: true });
  const scriptPath = path.join(tempDir, "decode.py");
  fs.writeFileSync(scriptPath, SCRIPT);
  try {
    const output = execFileSync("python", [scriptPath, target, payloadPath], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const line = output.trim().split("\n").pop();
    console.log(line);
    return JSON.parse(line).error ? 3 : 0;
  } catch (error) {
    console.log(`DECODE_FAILED ${String(error.message).split("\n").slice(-1)[0]}`);
    return 3;
  }
}

process.exit(main());
