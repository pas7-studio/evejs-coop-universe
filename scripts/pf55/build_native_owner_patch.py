#!/usr/bin/env python3
"""Read-only PF55 native owner patch builder (source-pinned).

Usage: python build_native_owner_patch.py --native-worktree /path/to/EveJS --output /tmp/pf55-owner.patch
Never mutates source. Verifies original git blob IDs and all exact replacement anchors.
"""
import argparse
import difflib
import subprocess
from pathlib import Path

PREFIX = "Code/server/src/space/"
FILES = {
    "coopNpcOrderArbiter.js": "aa5447ada4015b1ac8262d14bae5cd975af6ec6b",
    "coopNpcOrderBridge.js": "c0f93af3e5a67703a84dc03cab8da29a65afdf3b",
}


def change(src: str, name: str) -> str:
    replacements = []
    if name == "coopNpcOrderArbiter.js":
        replacements = [
            ('"CIVILIAN","WAR","EXPEDITION"]);',
             '"CIVILIAN","WAR","EXPEDITION","PERSONAL_FLEET"]);'),
            ('  if(existing.owner === owner) return true;\n  // Only the genuinely emergency-capable native tactics director can preempt.',
             '  if(existing.owner === owner) return true;\n'
             '  // A personal original ship is non-preemptive even by TACTICS.\n'
             '  if(existing.owner === "PERSONAL_FLEET") return false;\n'
             '  // Only the genuinely emergency-capable native tactics director can preempt.'),
        ]
    elif name == "coopNpcOrderBridge.js":
        replacements = [
            (' warShipClaim=null}={}) {', ' warShipClaim=null,pfShipClaim=null}={}) {'),
            (' if(warShipClaim!==null&&typeof warShipClaim!=="function")throw Error("WAR_SHIP_CLAIM_AUTHORITY_INVALID");',
             ' if(warShipClaim!==null&&typeof warShipClaim!=="function")throw Error("WAR_SHIP_CLAIM_AUTHORITY_INVALID");\n'
             ' if(pfShipClaim!==null&&typeof pfShipClaim!=="function")throw Error("PF55_CLAIM_AUTHORITY_INVALID");'),
            ('  // Even emergency tactics cannot override an in-flight native Destiny warp.',
             '  // The PF claim reader MUST come from the same original authoritative registry.\n'
             '  // When PF is enabled it must be wired: no fake UNASSIGNED fallback.\n'
             '  let pfClaim="UNKNOWN";\n'
             '  if(pfShipClaim)try{pfClaim=pfShipClaim(link)}catch{pfClaim="UNKNOWN"}\n'
             '  if(owner==="PERSONAL_FLEET"&&(!pfShipClaim||pfClaim!=="ASSIGNED"))\n'
             '   return {success:false,errorMsg:"PF55_NATIVE_ACTOR_CLAIM_UNVERIFIED"};\n'
             '  if(pfShipClaim&&owner!=="PERSONAL_FLEET"&&pfClaim!=="UNASSIGNED")\n'
             '   return {success:false,errorMsg:"PF55_NATIVE_ACTOR_RESERVED"};\n'
             '  if(pfShipClaim&&!(["UNASSIGNED","ASSIGNED","UNKNOWN"].includes(pfClaim)))\n'
             '   return {success:false,errorMsg:"PF55_NATIVE_ACTOR_REGISTRY_INVALID"};\n'
             '  // Even emergency tactics cannot override an in-flight native Destiny warp.'),
            ('  const warOwnsItsPatrol=owner==="WAR"&&warClaim==="ASSIGNED"&&!state.manualBusy;\n  const reason=state.warp?',
             '  const warOwnsItsPatrol=owner==="WAR"&&warClaim==="ASSIGNED"&&!state.manualBusy;\n'
             '  let pfClaim="UNKNOWN";\n'
             '  if(pfShipClaim)try{pfClaim=pfShipClaim(link)}catch{pfClaim="UNKNOWN"}\n'
             '  const reason=(owner==="PERSONAL_FLEET"&&(!pfShipClaim||pfClaim!=="ASSIGNED"))?\n'
             '   "PF55_NATIVE_ACTOR_CLAIM_UNVERIFIED":\n'
             '   (pfShipClaim&&owner!=="PERSONAL_FLEET"&&pfClaim!=="UNASSIGNED")?\n'
             '   "PF55_NATIVE_ACTOR_RESERVED":state.warp?'),
        ]
    else:
        raise ValueError("unexpected file")
    out = src
    for old, new in replacements:
        hits = out.count(old)
        if hits != 1:
            raise ValueError(f"{name}: anchor count {hits} instead of 1: {old[:72]}")
        out = out.replace(old, new, 1)
    return out


def blob_sha(worktree: Path, rel: str) -> str:
    return subprocess.check_output(
        ["git", "hash-object", "--", str(worktree / rel)], text=True
    ).strip()


def build(worktree: Path) -> str:
    chunks = []
    for name, expected in FILES.items():
        rel = PREFIX + name
        srcfile = worktree / rel
        if blob_sha(worktree, rel) != expected:
            raise ValueError(f"PF55_SOURCE_PIN_MISMATCH: {rel}")
        original = srcfile.read_text(encoding="utf8")
        changed = change(original, name)
        chunks.extend(difflib.unified_diff(
            original.splitlines(keepends=True),changed.splitlines(keepends=True),
            fromfile="a/"+rel,tofile="b/"+rel,n=4))
    return "".join(chunks)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--native-worktree", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    args = ap.parse_args()
    tree = args.native_worktree.resolve()
    if not (tree / ".git").exists():
        raise SystemExit("PF55_NATIVE_GIT_WORKTREE_REQUIRED")
    diff = build(tree)
    if not diff:
        raise SystemExit("PF55_NO_PATCH_GENERATED")
    # Verify before output is offered as applicable. Source stays read-only.
    subprocess.run(["git","-C",str(tree),"apply","--check","-"],
                   input=diff,text=True,check=True)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(diff,encoding="utf8")
    print(f"PF55 native owner patch verified: {args.output}")

if __name__ == "__main__":
    main()