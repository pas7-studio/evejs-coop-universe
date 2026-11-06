#!/usr/bin/env python3
"""PF62 -- read-only, source-pinned composition of PF58 + PF59 + PF61.

Reads a clean native EveJS checkout and a synchronized PR #350 checkout.
Writes a *separate review bundle* (never the native engine). Nothing is deployed,
committed, enabled or merged. Must not substitute for WORK/client E2E.
"""
from __future__ import annotations
import argparse
import difflib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

SERVICE = 'Code/server/src/space/npc/nativeNpcService.js'
STORE = 'Code/server/src/space/npc/nativeNpcStore.js'
SERVICE_BLOB = 'ca039daaaad2839d17f7109de2f3834cec0373a8'
STORE_BLOB = '95724ab4537683e7ee933bc3149d0a891082ce7e'
NATIVE_DIR = Path('Code/server/src/space')
MODULE_FILES = (
 'pf52/native/coopPersonalFleetHangarBridge.cjs',
 'pf53/native/coopPersonalFleetPaidHiring.cjs',
 'pf55/native/coopPersonalFleetNativeOrders.cjs',
 'pf55/native/coopPersonalFleetNpcRuntimeExecutor.cjs',
 'pf56/native/coopPersonalFleetReturnDock.cjs',
 'pf56/native/coopPersonalFleetNativeReturnExecutor.cjs',
 'pf57/native/coopPersonalFleetContractLifecycle.cjs',
 'pf58/native/coopPersonalFleetOriginalDeployment.cjs',
 'pf58/native/coopPersonalFleetNativeBootstrap.cjs',
 'pf58/native/coopPersonalFleetNativeBindings.cjs',
 'pf58/native/coopPersonalFleetOriginalShipHandoff.cjs',
 'pf58/native/coopPersonalFleetNativeShipAdoption.cjs',
 'pf58/native/coopPersonalFleetOriginalNativePermit.cjs',
 'pf59/native/coopPersonalFleetNativeRemovalGuard.cjs',
 'pf60/native/coopPersonalFleetTerminalCustody.cjs',
 'pf61/native/coopPersonalFleetScopedNativeCleanup.cjs',
)
LOCAL_IMPORT = re.compile(r'''require\(\s*['\"](\.[^'\"]+)['\"]\s*\)''')


def blob(raw: bytes) -> str:
    return hashlib.sha1(f'blob {len(raw)}\0'.encode('ascii') + raw).hexdigest()


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def import_python(path: Path):
    if not path.is_file():
        raise ValueError('PF62_REFERENCE_PATCH_BUILDER_MISSING: ' + str(path))
    spec = importlib.util.spec_from_file_location('pf62_' + path.parent.name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_patches(repo: Path):
    return (
      import_python(repo/'scripts/pf58/build_native_stock_fittings_patch.py'),
      import_python(repo/'scripts/pf59/build_native_removal_patch.py'),
      import_python(repo/'scripts/pf61/build_native_scoped_cleanup_patch.py'),
    )


def transform_original(original_service: str, original_store: str, patches):
    pf58,pf59,pf61=patches
    # Each reference must STILL refer to the same exact stock Git blob.
    if pf58.EXPECTED_SHA1 != SERVICE_BLOB or pf59.PINS.get(SERVICE) != SERVICE_BLOB:
        raise ValueError('PF62_SERVICE_SOURCE_PIN_INCONSISTENT')
    if pf59.PINS.get(STORE) != STORE_BLOB or pf61.PIN != STORE_BLOB:
        raise ValueError('PF62_STORE_SOURCE_PIN_INCONSISTENT')
    # The three standalone patches overlap. Transform the ORIGINAL source once.
    service=pf59.service_transform(pf58.transform(original_service))
    store=pf61.transform(pf59.store_transform(original_store))
    markers=(
      (service,'PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1:',1),
      (service,'pf59.checkOriginalRemoval(',2),
      (store,'pf59.checkOriginalRemoval(',3),
      (store,'PF61_SCOPED_ORIGINAL_NATIVE_CLEANUP_V1:',1),
    )
    for source,needle,count in markers:
        if source.count(needle)!=count:
            raise ValueError(f'PF62_COMPOSED_SOURCE_MARKER_MISMATCH: {needle}')
    # No second independent, conflicting source patch step is allowed.
    return service,store


def normalize_native_module(source: str, filename: str) -> str:
    if filename=='coopPersonalFleetScopedNativeCleanup.cjs':
        prior="require('../../pf60/native/coopPersonalFleetTerminalCustody.cjs')"
        if source.count(prior)!=1:
            raise ValueError('PF62_PF61_ARCHIVE_IMPORT_DRIFT')
        source=source.replace(prior,"require('./coopPersonalFleetTerminalCustody.js')")
    # Modules go into native Code/server/src/space as CommonJS .js files.
    # Node's extensionless require does not resolve .cjs automatically.
    return re.sub(r"(?<=\w)\.cjs(?=['\"]\s*\))",'.js',source)


def plan_modules(repo: Path) -> dict[str,str]:
    result={}
    for rel in MODULE_FILES:
        file=repo/'scripts'/rel
        if not file.is_file():
            raise ValueError('PF62_REQUIRED_NATIVE_MODULE_MISSING: '+str(file))
        dest=file.name.replace('.cjs','.js')
        if dest in result:
            raise ValueError('PF62_DUPLICATE_NATIVE_MODULE: '+dest)
        source=normalize_native_module(file.read_text(encoding='utf-8'),file.name)
        # No archive-relative import may survive the flattening.
        if '../../pf60/native/' in source or re.search(r'''require\(['\"]\./[^'\"]+\.cjs['\"]\)''',source):
            raise ValueError('PF62_UNRESOLVED_ARCHIVE_IMPORT: '+dest)
        result[dest]=source
    for dest,source in result.items():
        for match in LOCAL_IMPORT.finditer(source):
            name=match.group(1)
            if not name.startswith('./'):
                raise ValueError('PF62_IMPORT_OUTSIDE_NATIVE_MODULES: '+dest+' => '+name)
            target=name[2:]
            if Path(target).suffix=='': target+='.js'
            if target not in result:
                raise ValueError('PF62_NATIVE_LOCAL_REQUIRE_MISSING: '+dest+' => '+target)
    return result


def make_review_diff(sources: dict[str,tuple[str,str]]) -> str:
    sections=[]
    for rel,(original,changed) in sources.items():
        if changed==original:raise ValueError('PF62_EMPTY_NATIVE_TRANSFORM: '+rel)
        sections.extend(difflib.unified_diff(original.splitlines(keepends=True),
                    changed.splitlines(keepends=True),fromfile='a/'+rel,tofile='b/'+rel))
    return ''.join(sections)


def validate_paths(engine: Path, repo: Path, output: Path):
    engine=engine.resolve(); repo=repo.resolve(); output=output.resolve()
    if engine==repo or not (engine/'Code/server/src/space/npc/nativeNpcService.js').is_file():
        raise ValueError('PF62_NATIVE_FORK_CHECKOUT_REQUIRED')
    if output==engine or output.is_relative_to(engine) or output==repo or output.is_relative_to(repo) or repo.is_relative_to(output):
        raise ValueError('PF62_NEVER_WRITE_NATIVE_FORK_OR_ORCHESTRATION_REPO')
    if output.exists() and any(output.iterdir()):
        raise ValueError('PF62_REVIEW_OUTPUT_MUST_BE_EMPTY')
    return engine,repo,output


def compile_js(output: Path, files: list[Path]):
    node=shutil.which('node')
    if not node:raise ValueError('PF62_NODE22_REQUIRED')
    ver=subprocess.run([node,'-p','Number(process.versions.node.split(".")[0])'],
                       capture_output=True,text=True,check=True)
    if int(ver.stdout.strip())<22:raise ValueError('PF62_NODE22_REQUIRED')
    for f in files:
        subprocess.run([node,'--check',str(output/f)],check=True,capture_output=True,text=True)
    # All new modules must load together in their actual native .js layout.
    # This executes only module initialization; it neither creates a server nor
    # calls exported gameplay methods. It catches missing/circular archive paths.
    modules=[str((output/f).resolve()) for f in files if f.parent==NATIVE_DIR]
    probe='for(const p of '+json.dumps(modules)+' ) require(p);'
    subprocess.run([node,'-e',probe],check=True,capture_output=True,text=True)


def build(engine: Path, repo: Path, output: Path, *, verify_syntax=True):
    engine,repo,output=validate_paths(engine,repo,output)
    raw_s=(engine/SERVICE).read_bytes();raw_n=(engine/STORE).read_bytes()
    if blob(raw_s)!=SERVICE_BLOB or blob(raw_n)!=STORE_BLOB:
        raise ValueError('PF62_SOURCE_PIN_MISMATCH: engine source differs from reviewed native fork')
    modules=plan_modules(repo)
    original_s=raw_s.decode('utf-8');original_n=raw_n.decode('utf-8')
    combined_s,combined_n=transform_original(original_s,original_n,load_patches(repo))
    sources={SERVICE:(original_s,combined_s),STORE:(original_n,combined_n)}
    patch=make_review_diff(sources)
    # Validate ALL preconditions before making the first output file.
    output.mkdir(parents=True,exist_ok=True)
    created={}
    for rel,contents in [(SERVICE,combined_s),(STORE,combined_n),
                         *((str(NATIVE_DIR/name),source) for name,source in modules.items())]:
        path=output/rel;path.parent.mkdir(parents=True,exist_ok=True)
        encoded=contents.encode('utf-8');path.write_bytes(encoded)
        created[rel]={'sha256':sha256(encoded),'bytes':len(encoded)}
    (output/'PF62-NATIVE-REVIEW.patch').write_text(patch,encoding='utf-8')
    git=shutil.which('git')
    if git is None: raise ValueError('PF62_GIT_REQUIRED_FOR_READ_ONLY_APPLY_CHECK')
    # This checks a patch WITHOUT applying it, without editing either checkout.
    subprocess.run([git,'-C',str(engine),'apply','--check',
                    str(output/'PF62-NATIVE-REVIEW.patch')],
                   check=True,capture_output=True,text=True)
    created['PF62-NATIVE-REVIEW.patch']={'sha256':sha256(patch.encode()),'bytes':len(patch.encode())}
    if verify_syntax:compile_js(output,[Path(p) for p in created if p.endswith(".js")])
    manifest={
      'name':'PF62_NATIVE_REVIEW_BUNDLE','status':'NOT_INSTALLED_IN_EVEJS',
      'targetFork':'pas7-studio/EveJS coop/pas7std',
      'stockBlobs':{SERVICE:SERVICE_BLOB,STORE:STORE_BLOB},
      'featureEnabled':False,'gameplayE2E':'NOT_RUN',
      'files':created,
      'instructions':'Review, commit to the ENGINE FORK in a separate WORK branch. NEVER activate PLAY from this package.',
    }
    (output/'PF62-MANIFEST.json').write_text(json.dumps(manifest,indent=2,sort_keys=True)+'\n',encoding='utf-8')
    return manifest


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine',type=Path,required=True,help='read-only original native checkout')
    parser.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[2],help='synchronized PR #350 checkout')
    parser.add_argument('--output',type=Path,required=True,help='EMPTY out-of-tree review folder')
    args=parser.parse_args()
    report=build(args.engine,args.repo,args.output)
    print(json.dumps({'status':report['status'],'compiledFileCount':len(report['files'])-1,
     'output':str(args.output)},indent=2))
    print('NOT INSTALLED; WORK/PLAY untouched; Personal Fleet OFF.')

if __name__=='__main__':main()
