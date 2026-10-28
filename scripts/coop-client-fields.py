#!/usr/bin/env python3
"""Derive what each client->server call reads from the answer, so nobody needs the client.

A cloud or web agent cannot decompile the client: it has no game install, no Python 2.7
bytecode and no uncompyle6. This tool runs where the client does exist and writes
``docs/client-contracts/field-reads.json`` - for every ``RemoteSvc('service').Method`` the
pinned client issues, the attributes and row columns the client reads off the answer, with
the module and line that reads them. Only names and locations are recorded, never client
code, so the result is safe to commit (see ``AGENTS.md``).

    python scripts/coop-client-code.py --digest          # rewrite docs/client-contracts/field-reads.json
    python scripts/coop-client-code.py --digest --check  # exit 1 when the file is out of date

Heuristics, stated so nobody over-trusts them: a call is matched to the variable it is
assigned to in the same statement; attribute/column reads are collected inside that
variable's enclosing block (until a line at the same or lower indentation that starts a new
statement block). Reads through a temporary, a return value or a bound moniker are missed.
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util

_spec = importlib.util.spec_from_file_location(
    "coop_client_code", os.path.join(os.path.dirname(os.path.abspath(__file__)), "coop-client-code.py")
)
coop = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(coop)

REMOTE = re.compile(r"RemoteSvc\(\s*'([A-Za-z0-9_]+)'\s*\)\s*\.\s*([A-Za-z0-9_]+)\s*\(")
PROXY = re.compile(r"ProxySvc\(\s*'([A-Za-z0-9_]+)'\s*\)\s*\.\s*([A-Za-z0-9_]+)\s*\(")
ASSIGN = re.compile(r"((?:self\.)?[A-Za-z_][A-Za-z0-9_]*)\s*=\s*.*(?:RemoteSvc|ProxySvc)\(")
INDEX = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)\.Index\(\s*'([A-Za-z0-9_]+)'\s*\)")
ATTR = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)")
LOOP = re.compile(r"for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([A-Za-z_][A-Za-z0-9_]*)")
NOISE = {
    "append", "reversed", "sorted", "get", "items", "iteritems", "keys", "values",
    "itervalues", "index", "len", "str", "int", "float", "format", "join", "copy",
}


def indent_of(line):
    return len(line) - len(line.lstrip())


def collect(lines, start, target):
    """Attributes and columns read from `target` inside its block, plus loop row reads."""
    fields, columns = set(), set()
    dotted = target.startswith("self.")
    if dotted:
        # `self.store = sm.RemoteSvc(...)` is read later as `self.store.field`; match that
        # chain explicitly, since the generic attribute regex would report `self`.
        pattern_field = re.compile(re.escape(target) + r"\.([A-Za-z][A-Za-z0-9_]*)")
        pattern_index = re.compile(re.escape(target) + r"\.Index\(\s*'([A-Za-z0-9_]+)'\s*\)")
        pattern_loop = re.compile(r"for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+" + re.escape(target) + r"\b")
        for index in range(start, min(len(lines), len(lines))):
            line = lines[index]
            for match in pattern_index.finditer(line):
                columns.add(match.group(1))
            for match in pattern_field.finditer(line):
                name = match.group(1)
                if name not in NOISE and name != "Index":
                    fields.add(name)
            loop = pattern_loop.search(line)
            if loop:
                row = loop.group(1)
                for offset in range(index + 1, min(len(lines), index + 12)):
                    row_line = lines[offset]
                    if row_line.strip() and len(row_line) - len(row_line.lstrip()) <= len(line) - len(line.lstrip()):
                        break
                    for match in ATTR.finditer(row_line):
                        if match.group(1) == row and match.group(2) not in NOISE:
                            fields.add(match.group(2))
        return sorted(fields), sorted(columns)
    base = indent_of(lines[start]) if start < len(lines) else 0
    for index in range(start, min(len(lines), start + 60)):
        line = lines[index]
        stripped = line.strip()
        if index > start and stripped and indent_of(line) <= base and re.match(
            r"(def |class |for |if |elif |else:|try:|except|while |with )", stripped
        ):
            if not stripped.startswith(("for ", "if ", "try:")) or index > start + 1:
                break
        match = INDEX.search(line)
        if match and match.group(1) == target:
            columns.add(match.group(2))
        for match in ATTR.finditer(line):
            if match.group(1) != target:
                continue
            name = match.group(2)
            if name and name not in NOISE:
                fields.add(name)
        loop = LOOP.search(line)
        if loop and loop.group(2) == target:
            row = loop.group(1)
            for offset in range(index + 1, min(len(lines), index + 12)):
                row_line = lines[offset]
                if indent_of(row_line) <= indent_of(line) and row_line.strip():
                    break
                for match in ATTR.finditer(row_line):
                    if match.group(1) == row and match.group(2) not in NOISE:
                        fields.add(match.group(2))
    return sorted(fields), sorted(columns)


def build(cache_dir):
    archive_path = coop.code_ccp_path()
    import zipfile

    archive = zipfile.ZipFile(archive_path)
    if not coop.ensure_decompiler():
        raise SystemExit(2)
    entries = {}
    import zlib

    for name in coop.module_entries(archive):
        try:
            raw = zlib.decompress(zipfile.ZipFile.read(archive, name))
        except Exception:  # noqa: BLE001
            continue
        if b"RemoteSvc" not in raw and b"ProxySvc" not in raw:
            continue
        source = coop.cached(archive, name, cache_dir)
        if not source:
            continue
        lines = source.split("\n")
        for index, line in enumerate(lines):
            for pattern in (REMOTE, PROXY):
                for match in pattern.finditer(line):
                    service, method = match.group(1), match.group(2)
                    key = service + "." + method
                    assigned = ASSIGN.search(line)
                    entry = entries.setdefault(key, {
                        "service": service, "method": method,
                        "modules": set(), "fields": set(), "columns": set(),
                    })
                    entry["modules"].add(name)
                    if assigned:
                        fields, columns = collect(lines, index, assigned.group(1))
                        entry["fields"].update(fields)
                        entry["columns"].update(columns)
    out = {}
    for key in sorted(entries):
        entry = entries[key]
        out[key] = {
            "service": entry["service"],
            "method": entry["method"],
            "modules": sorted(entry["modules"])[:4],
            "fields": sorted(entry["fields"]),
            "columns": sorted(entry["columns"]),
        }
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--digest", action="store_true", help="rewrite the field-read digest")
    parser.add_argument("--check", action="store_true", help="compare instead of writing")
    parser.add_argument("--cache", default=coop.DEFAULT_CACHE)
    parser.add_argument("--output", default=os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "docs", "client-contracts", "field-reads.json"))
    args = parser.parse_args()
    if not args.digest and not args.check:
        parser.error("pass --digest or --check")

    digest = build(args.cache)
    payload = {
        "source": "derived from the pinned client's bytecode; names only, no client code",
        "calls": digest,
    }
    text = json.dumps(payload, indent=1, sort_keys=True) + "\n"
    if args.check:
        current = ""
        if os.path.exists(args.output):
            with open(args.output, "r", encoding="utf-8") as handle:
                current = handle.read()
        if current != text:
            sys.stderr.write("FIELD_READS_OUT_OF_DATE: run without --check to rewrite\n")
            return 1
        print("FIELD_READS_OK calls=%d" % len(digest))
        return 0
    with open(args.output, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    named = sum(1 for entry in digest.values() if entry["fields"] or entry["columns"])
    print("FIELD_READS_WRITTEN calls=%d with_fields=%d" % (len(digest), named))
    return 0


if __name__ == "__main__":
    sys.exit(main())
