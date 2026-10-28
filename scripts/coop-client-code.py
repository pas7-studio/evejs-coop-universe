#!/usr/bin/env python3
"""Read a module of the installed EVE client on demand, without vendoring it.

The client's Python lives in ``tq/code.ccp``: a ZIP whose entries are already complete
Python 2.7 ``.pyc`` files (magic included), zlib-compressed. Decompiling the modules you
need, into a cache outside the repository, is the one way to read the client's own contract
without copying CCP's code into this repo (see ``AGENTS.md``: no vendored client files).

    python scripts/coop-client-code.py --list
    python scripts/coop-client-code.py --module eve/client/script/ui/services/facWarSvc
    python scripts/coop-client-code.py --grep FACTION_ID_TO_COLOR
    python scripts/coop-client-code.py --grep "GetAllWarzonesOccupationStates" --context 3

Environment:
    EVEJS_CLIENT_CODE_CCP   path to code.ccp (default: the W:\\ install)
    EVEJS_UNCOMPYLE_DIR     directory containing the uncompyle6 package
                            (default: %TEMP%/opencode/evdec; install with
                            python -m pip install --target <dir> uncompyle6)

The cache defaults to ``%TEMP%/opencode/client-code`` and is never committed: it is derived
from proprietary files and must not enter the repository.
"""
import argparse
import os
import sys
import tempfile
import zipfile
import zlib

DEFAULT_CCP = r"W:/EVE Online - 3396210/tq/code.ccp"
DEFAULT_CACHE = os.path.join(tempfile.gettempdir(), "opencode", "client-code")
DEFAULT_UNCOMPYLE = os.path.join(tempfile.gettempdir(), "opencode", "evdec")


def code_ccp_path():
    return os.environ.get("EVEJS_CLIENT_CODE_CCP") or DEFAULT_CCP


def ensure_decompiler():
    target = os.environ.get("EVEJS_UNCOMPYLE_DIR") or DEFAULT_UNCOMPYLE
    if os.path.isdir(target) and target not in sys.path:
        sys.path.insert(0, target)
    try:
        from uncompyle6.main import decompile_file  # noqa: F401
    except Exception:
        sys.stderr.write(
            "uncompyle6 is not available. Install it once with:\n"
            "  python -m pip install --target \"%s\" uncompyle6\n" % target
        )
        return False
    return True


def module_entries(archive):
    return [name for name in archive.namelist() if name.endswith(".pyj")]


def read_module(archive, name):
    """Return the decompiled source of one .pyj entry, or None when decompilation fails."""
    from uncompyle6.main import decompile_file

    data = zlib.decompress(archive.read(name))
    handle, path = tempfile.mkstemp(suffix=".pyc")
    os.close(handle)
    try:
        with open(path, "wb") as handle_out:
            handle_out.write(data)
        import io

        buffer = io.StringIO()
        decompile_file(path, buffer)
        return buffer.getvalue()
    except Exception as error:  # noqa: BLE001 - a module that will not decompile is not fatal
        return "# decompilation failed: %s\n" % error
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def cached(archive, name, cache_dir):
    """Decompile once and keep the text in the cache directory."""
    flat = name.replace("/", "__") + ".py"
    target = os.path.join(cache_dir, flat)
    if os.path.exists(target):
        with open(target, "r", encoding="utf-8", errors="replace") as handle:
            return handle.read()
    source = read_module(archive, name)
    if source is None:
        return None
    os.makedirs(cache_dir, exist_ok=True)
    with open(target, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(source)
    return source


def normalize(name):
    name = name.strip().lstrip("/")
    if name.startswith("eve/"):
        return name + (".pyj" if not name.endswith(".pyj") else "")
    return name + (".pyj" if not name.endswith(".pyj") else "")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--list", action="store_true", help="list every module the archive holds")
    group.add_argument("--module", help="print one module (path without the .pyj suffix)")
    group.add_argument("--grep", help="decompile only the modules containing this text and print the matches")
    parser.add_argument("--context", type=int, default=2, help="lines of context around each grep hit")
    parser.add_argument("--limit", type=int, default=20, help="how many modules --grep may decompile")
    parser.add_argument("--cache", default=DEFAULT_CACHE, help="decompiled-text cache directory")
    args = parser.parse_args()

    archive_path = code_ccp_path()
    if not os.path.exists(archive_path):
        sys.stderr.write("client archive not found: %s (set EVEJS_CLIENT_CODE_CCP)\n" % archive_path)
        return 2
    archive = zipfile.ZipFile(archive_path)

    if args.list:
        for name in module_entries(archive):
            print(name)
        return 0

    if not ensure_decompiler():
        return 2

    if args.module:
        name = normalize(args.module)
        if name not in archive.namelist():
            matches = [entry for entry in module_entries(archive) if args.module.strip("/") in entry]
            sys.stderr.write(
                "no such module: %s\n%s\n"
                % (name, "\n".join("  candidate: " + match for match in matches[:10]) or "  no candidate")
            )
            return 2
        source = cached(archive, name, args.cache)
        sys.stdout.write(source or "")
        return 0

    needle = args.grep.encode("utf-8")
    visited = 0
    hits = 0
    for name in module_entries(archive):
        try:
            raw = zlib.decompress(archive.read(name))
        except Exception:  # noqa: BLE001
            continue
        if needle not in raw:
            continue
        visited += 1
        if visited > args.limit:
            sys.stderr.write("stopped after %d modules, raise --limit to search further\n" % args.limit)
            break
        source = cached(archive, name, args.cache)
        if not source:
            continue
        lines = source.split("\n")
        for index, line in enumerate(lines):
            if args.grep in line:
                hits += 1
                low = max(0, index - args.context)
                high = min(len(lines), index + args.context + 1)
                print("=== %s:%d" % (name, index + 1))
                for offset in range(low, high):
                    print("   ", lines[offset].rstrip())
    if not hits:
        sys.stderr.write("no matches for %r\n" % args.grep)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
