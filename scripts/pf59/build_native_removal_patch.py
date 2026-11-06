#!/usr/bin/env python3
"""PF59 exact-blob-pinned, read-only EveJS native removal patch generator.

Generates reviewable diffs but NEVER edits the native fork or turns on flags.
This is NOT enough to activate Personal Fleet; stock ownership writers and
PF58's native service patch must be composed and manually reviewed.
"""
import argparse
import difflib
import hashlib
from pathlib import Path

SERVICE = 'Code/server/src/space/npc/nativeNpcService.js'
STORE = 'Code/server/src/space/npc/nativeNpcStore.js'
PINS = {
    SERVICE: 'ca039daaaad2839d17f7109de2f3834cec0373a8',
    STORE: '95724ab4537683e7ee933bc3149d0a891082ce7e',
}

def git_blob_sha(raw: bytes) -> str:
    return hashlib.sha1(f'blob {len(raw)}\0'.encode('ascii') + raw).hexdigest()

def single_replace(text, before, after, name):
    count = text.count(before)
    if count != 1:
        raise ValueError(f'PF59_{name}_ANCHOR_DRIFT count={count}')
    return text.replace(before, after, 1)

def insert_after_function_start(source, signature, first_line, insertion, name):
    """Insert before first side effect of exactly one original function body."""
    if source.count(signature) != 1:
        raise ValueError(f'PF59_{name}_SIGNATURE_DRIFT')
    head, tail = source.split(signature, 1)
    next_function = tail.find('\nfunction ')
    section = tail if next_function < 0 else tail[:next_function]
    suffix = '' if next_function < 0 else tail[next_function:]
    if section.count(first_line) != 1:
        raise ValueError(f'PF59_{name}_BODY_DRIFT count={section.count(first_line)}')
    section = section.replace(first_line, insertion + first_line, 1)
    return head + signature + section + suffix

def service_transform(source: str) -> str:
    for name in ('destroyNativeNpcController', 'dematerializeNativeController'):
        sig=f'function {name}(controller, options = {{}}) {{'
        injection=(
            '  // PF59: before ANY side effect, deny generic deletion of original stock ships.\n'
            '  const pf59 = require(path.join(__dirname, "../coopPersonalFleetNativeRemovalGuard"));\n'
            '  const pf59Decision = pf59.checkOriginalRemoval(entityID, nativeNpcStore);\n'
            '  if (pf59Decision.success !== true) return pf59Decision;\n'
        )
        source=insert_after_function_start(source, sig,
            '  const scene = spaceRuntime.ensureScene(systemID);\n', injection, name)
    return source

def store_transform(source: str) -> str:
    injection=(
        '  // PF59: protect original ItemStore ship even if a caller bypasses the NPC service.\n'
        '  const pf59 = require(path.join(__dirname, "../coopPersonalFleetNativeRemovalGuard"));\n'
        '  const pf59Decision = pf59.checkOriginalRemoval(entityID, module.exports);\n'
        '  if (pf59Decision.success !== true) return pf59Decision;\n'
    )
    source=insert_after_function_start(source,'function removeNativeEntityCascade(entityID) {',
        '  for (const moduleRecord of listNativeModulesForEntity(normalizedEntityID)) {\n',
        injection, 'CASCADE')
    source=insert_after_function_start(source,'function removeNativeEntity(entityID) {',
        '  return removeCollectionRow(TABLE.ENTITIES, "entities", entityID);\n',
        injection,'ENTITY')
    source=insert_after_function_start(source,'function removeNativeController(entityID) {',
        '  const removeResult = removeCollectionRow(TABLE.CONTROLLERS, "controllers", entityID);\n',
        injection,'CONTROLLER')
    return source

def build(checkout: Path, output: Path) -> str:
    patches=[]
    for rel, transform in [(SERVICE,service_transform),(STORE,store_transform)]:
        raw=(checkout / rel).read_bytes()
        if git_blob_sha(raw)!=PINS[rel]:
            raise ValueError(f'PF59_SOURCE_PIN_MISMATCH {rel}: expected {PINS[rel]}, got {git_blob_sha(raw)}')
        old=raw.decode('utf-8')
        new=transform(old)
        patches.extend(difflib.unified_diff(old.splitlines(keepends=True),
            new.splitlines(keepends=True),fromfile='a/'+rel,tofile='b/'+rel))
    patch=''.join(patches)
    if not patch: raise ValueError('PF59_EMPTY_PATCH')
    output.write_text(patch,encoding='utf-8')
    return patch

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('checkout',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    patch=build(args.checkout,args.output)
    print(f'PF59 source-pinned native review diff: {args.output} ({len(patch)} chars)')
    print('NOT APPLIED. No real EveJS or WORK gameplay tested. PF flag OFF.')

if __name__=='__main__': main()
