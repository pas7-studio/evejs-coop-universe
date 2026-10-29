"""Extract a flatbuffer table layout from a decompiled client module.

The client's generated modules contain, for every table, `<Table>Start(builder)` with the field
count and `<Table>Add<Field>(builder, value)` calls that name the slot index and the prepend type.
Those two facts are the authoritative layout, so this reads them instead of guessing from getters.

Usage:
  python scripts/coop-client-code.py --module <path>.pyj > /tmp/mod.pyj
  python scripts/coop-flatbuffer-schema.py /tmp/mod.pyj docs/client-contracts/<name>-flatbuffer.json

Only derived structure is written - never the decompiled source, which is CCP code.
"""
import json, re, sys

lines = open(sys.argv[1], encoding="utf-8").read().split("\n")
tables, current = {}, None
for i, line in enumerate(lines):
    m = re.match(r"class (\w+)\(object\):", line)
    if m:
        current = m.group(1)
        tables.setdefault(current, {"fields": {}, "nfields": 0})
        continue
    if current is None:
        continue
    m = re.search(r"(\w+)Start\(builder\):", line)
    if m:
        for probe in lines[i:i+4]:
            s = re.search(r"builder\.StartObject\((\d+)\)", probe)
            if s:
                tables[current]["nfields"] = int(s.group(1))
                break
        continue
    m = re.search(r"def (\w+)Add(\w+)\(builder, \w+\):", line)
    if m:
        prefix, name = m.group(1), m.group(2)
        body = "\n".join(lines[i:i+6])
        s = re.search(r"Prepend\w*Slot\((\d+),\s*flatbuffers\.number_types\.(\w+)", body)
        if not s:
            s = re.search(r"Slot\((\d+),", body)
        slot = int(s.group(1)) if s else None
        kind = s.group(2) if (s and s.lastindex and s.lastindex > 1) else "uoffset"
        if slot is not None:
            tables[current]["fields"][name] = {"slot": slot, "kind": kind}

out = {}
for name, table in tables.items():
    if not table["fields"]:
        continue
    out[name] = {
        "nfields": table["nfields"],
        "fields": {f: v for f, v in sorted(table["fields"].items(), key=lambda kv: kv[1]["slot"])},
    }
json.dump(out, open(sys.argv[2], "w"), indent=1, sort_keys=True)
print(len(out), "tables")
for name in sorted(out):
    print(name, out[name]["nfields"], [(f, v["slot"], v["kind"]) for f, v in out[name]["fields"].items()])
