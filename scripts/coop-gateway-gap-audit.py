#!/usr/bin/env python3
"""Which gateway request types does the installed client send that this server cannot answer?

The "remaining gaps" list in state/NOW.md is written by hand, so it can only contain the gaps
somebody already thought of. This audit derives the list from the two artefacts that actually
decide it:

* the client's own code (``tq/code.ccp``): the generated ``*_pb2`` modules declare the request
  messages with their full names, and a non-generated module that names both a proto module path
  and one of that module's request classes is code that really sends it;
* the running server: a file of answered request types, one per line, produced by
  ``_testing.gatewayServiceRegistry`` inside the container (see the usage line).

Strings are read straight out of the module's marshal stream (a py2.7 ``.pyc`` stores a string as
tag ``t``/``s``, a 4-byte length, then the bytes), because a regex over the whole file glues the
next marshalled field onto the name - that is how the first version of this script found eight
request types instead of thousands.

The client is CCP code, so nothing is written into the repository except the derived list of type
names and the counts (``docs/client-contracts/gateway-coverage.json``).

Usage:
  MSYS_NO_PATHCONV=1 docker exec <server> node /tmp/probe-handled.js > handled.txt
  python scripts/coop-gateway-gap-audit.py handled.txt [--write]
"""
import json
import os
import re
import sys
import zipfile
import zlib

DEFAULT_CCP = r"W:/EVE Online - 3396210/tq/code.ccp"
GENERATED_PREFIX = "eveProto/generated/"
IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_.]*$")


def strings_of(data):
    """Every exact string constant in a compressed py2.7 module, from the marshal stream."""
    out = set()
    size = len(data)
    for index in range(size - 5):
        tag = data[index]
        if tag != 0x74 and tag != 0x73:  # 't' interned / 's' string
            continue
        length = int.from_bytes(data[index + 1:index + 5], "little")
        if not 4 <= length <= 400 or index + 5 + length > size:
            continue
        try:
            text = data[index + 5:index + 5 + length].decode("ascii")
        except UnicodeDecodeError:
            continue
        if IDENTIFIER.match(text):
            out.add(text)
    return out


def entries(path):
    with zipfile.ZipFile(path) as archive:
        for info in archive.infolist():
            if not info.filename.endswith((".pyc", ".pyj")):
                continue
            try:
                raw = archive.read(info)
            except Exception:  # a corrupt entry must not hide the rest of the audit
                continue
            try:
                yield info.filename, zlib.decompress(raw)
            except zlib.error:
                yield info.filename, raw


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    handled_path = sys.argv[1]
    write = "--write" in sys.argv
    handled = {
        line.strip()
        for line in open(handled_path, encoding="utf-8")
        if line.strip().startswith("eve")
    }

    requests = {}                 # request full name -> proto module (dotted)
    by_module = {}                # proto module (dotted) -> request full names
    client_modules = []           # string sets of the modules that are not generated proto code

    for name, data in entries(os.environ.get("EVEJS_CLIENT_CODE_CCP") or DEFAULT_CCP):
        if name.startswith(GENERATED_PREFIX):
            module = os.path.splitext(name[len(GENERATED_PREFIX):])[0].replace("/", ".")
            found = set()
            for text in strings_of(data):
                if not text.endswith("Request"):
                    continue
                if not text.startswith(("eve.", "eve_public.")):
                    continue
                if any(part.endswith("_pb2") for part in text.split(".")):
                    continue
                requests[text] = module
                found.add(text)
            if found:
                by_module[module] = found
            continue
        client_modules.append(strings_of(data))

    # A module that imports two proto files which both declare a message of the same simple name
    # (planet and star both have GetAllConfigurationsRequest) cannot be attributed by the class name
    # alone, so those pairs are reported as ambiguous instead of claimed as consumed. Without this
    # the "still open" list grows phantom gaps that no client code actually sends.
    consumed = set()
    ambiguous = set()
    for strings in client_modules:
        imported = [module for module in by_module
                    if "eveProto.generated." + module in strings]
        if not imported:
            continue
        by_simple = {}
        for module in imported:
            for full_name in by_module[module]:
                by_simple.setdefault(full_name.rsplit(".", 1)[-1], []).append(full_name)
        for simple, full_names in by_simple.items():
            if simple not in strings:
                continue
            if len(full_names) > 1:
                ambiguous.update(full_names)
                continue
            consumed.add(full_names[0])
    consumed -= ambiguous

    unhandled = sorted(consumed - handled)
    extra = sorted(handled - set(requests))
    print(f"client request types       {len(requests)}")
    print(f"consumed by client code    {len(consumed)}")
    print(f"answered by this server    {len(handled)}")
    print(f"CONSUMED_NOT_ANSWERED      {len(unhandled)}")
    for name in unhandled:
        print(f"  {name}")
    if ambiguous:
        print(f"AMBIGUOUS_ATTRIBUTION      {len(ambiguous)} (class name declared by several imported protos)")
        for name in sorted(ambiguous):
            print(f"  {name}")
    print(f"ANSWERED_NOT_IN_CLIENT     {len(extra)}")
    for name in extra:
        print(f"  {name}")

    if write:
        out = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "docs", "client-contracts", "gateway-coverage.json",
        )
        json.dump(
            {
                "note": "Derived from the installed client archive and the running server; "
                        "contains type names only, never client code.",
                "clientRequestTypes": len(requests),
                "consumedByClient": len(consumed),
                "answeredByServer": len(handled),
                "consumedNotAnswered": unhandled,
                "ambiguousAttribution": sorted(ambiguous),
                "answeredNotInClient": extra,
            },
            open(out, "w", encoding="utf-8"), indent=1,
        )
        print(f"WROTE {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
