#!/usr/bin/env python3
"""Which notice types does the installed client wait for that this server never publishes?

A gRPC "request" is something the client asks for and the server answers. A "notice" is the
opposite: the client subscribes once and waits, and a server that never publishes one leaves the
window frozen on whatever the last read returned. That class of gap is invisible to
``coop-gateway-gap-audit.py``, which only looks at requests.

The method is the same as that audit's, because it must not read client code:

* the client's generated ``*_pb2`` modules declare the notice messages with their full names;
* a non-generated module that names both a proto module path and one of that module's notice
  classes is code that really subscribes to it;
* the server side is a file of published notice type names, one per line, produced from the
  deployed source (see the usage line).

Nothing is written into the repository except the derived type names.

Usage:
  node scripts/coop-published-notices.cjs > published.txt
  python scripts/coop-gateway-notice-audit.py published.txt [--write]
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
    published_path = sys.argv[1]
    write = "--write" in sys.argv
    published = {
        line.strip()
        for line in open(published_path, encoding="utf-8")
        if line.strip().startswith("eve")
    }

    notices = {}                  # notice full name -> proto module (dotted)
    by_module = {}
    client_modules = []

    for name, data in entries(os.environ.get("EVEJS_CLIENT_CODE_CCP") or DEFAULT_CCP):
        if name.startswith(GENERATED_PREFIX):
            module = os.path.splitext(name[len(GENERATED_PREFIX):])[0].replace("/", ".")
            found = set()
            for text in strings_of(data):
                if not text.endswith("Notice"):
                    continue
                if not text.startswith(("eve.", "eve_public.")):
                    continue
                if any(part.endswith("_pb2") for part in text.split(".")):
                    continue
                notices[text] = module
                found.add(text)
            if found:
                by_module[module] = found
            continue
        client_modules.append(strings_of(data))

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

    silent = sorted(consumed - published)
    print(f"client notice types       {len(notices)}")
    print(f"subscribed by client code {len(consumed)}")
    print(f"published by this server  {len(published)}")
    print(f"SUBSCRIBED_NOT_PUBLISHED  {len(silent)}")
    for name in silent:
        print(f"  {name}")
    if ambiguous:
        print(f"AMBIGUOUS_ATTRIBUTION     {len(ambiguous)}")
    extra = sorted(published - set(notices))
    print(f"PUBLISHED_NOT_IN_CLIENT   {len(extra)}")
    for name in extra[:10]:
        print(f"  {name}")

    if write:
        out = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "docs", "client-contracts", "notice-coverage.json",
        )
        json.dump(
            {
                "note": "Derived from the installed client archive and the deployed server; "
                        "type names only, never client code.",
                "clientNoticeTypes": len(notices),
                "subscribedByClient": len(consumed),
                "publishedByServer": len(published),
                "subscribedNotPublished": silent,
                "ambiguousAttribution": sorted(ambiguous),
                "publishedNotInClient": extra,
            },
            open(out, "w", encoding="utf-8"), indent=1,
        )
        print(f"WROTE {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
