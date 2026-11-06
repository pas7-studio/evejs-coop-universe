#!/usr/bin/env python3
"""PF62 -- read-only, source-pinned composition of PF58 + PF59 + PF61 + PF66.

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
import tempfile

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
 'pf66/native/coopPersonalFleetScopedDock.cjs',
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
      import_python(repo/'scripts/pf66/build_native_dock_scene_patch.py'),
    )


def transform_original(original_service: str, original_store: str, patches):
    if len(patches) not in (3,4):
        raise ValueError('PF66_PATCH_SET_INVALID')
    pf58,pf59,pf61=patches[:3]
    pf66=patches[3] if len(patches)==4 else None
    # Each reference must STILL refer to the same exact stock Git blob.
    if pf58.EXPECTED_SHA1 != SERVICE_BLOB or pf59.PINS.get(SERVICE) != SERVICE_BLOB:
        raise ValueError('PF62_SERVICE_SOURCE_PIN_INCONSISTENT')
    if pf59.PINS.get(STORE) != STORE_BLOB or pf61.PIN != STORE_BLOB:
        raise ValueError('PF62_STORE_SOURCE_PIN_INCONSISTENT')
    if pf66 is not None and pf66.PIN != SERVICE_BLOB:
        raise ValueError('PF66_SERVICE_SOURCE_PIN_INCONSISTENT')
    # The three standalone patches overlap. Transform the ORIGINAL source once.
    service=pf59.service_transform(pf58.transform(original_service))
    if pf66 is not None:
        service=pf66.transform(service)
    store=pf61.transform(pf59.store_transform(original_store))
    markers=(
      (service,'PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1:',1),
      (service,'pf59.checkOriginalRemoval(',2),
      (store,'pf59.checkOriginalRemoval(',3),
      (store,'PF61_SCOPED_ORIGINAL_NATIVE_CLEANUP_V1:',1),
      *((service,'PF66_SCOPED_DOCK_SCENE_DETACH_V1:',1),) if pf66 is not None else (),
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
    normalized=re.sub(r"(?<=\w)\.cjs(?=['\"]\s*\))",'.js',source)
    # Four archived modules have no terminal LF. A Git new-file hunk needs a
    # canonical final newline; normalize ONLY staged copies, never archives.
    return normalized if normalized.endswith('\n') else normalized+'\n'


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


def make_review_diff(sources: dict[str,tuple[str,str]],
                     added: dict[str,str] | None = None) -> str:
    """One git-apply compatible patch for BOTH changed stock files AND new modules.

    A stock-only diff produced a dangerous partial installation: reviewers could
    apply the patch successfully without installing any of its required modules.
    The complete patch now fails `git apply --check` if any target module already
    exists, and `git apply` on a disposable source snapshot must reproduce the
    exact staged bytes before this bundle is accepted.
    """
    sections=[]
    seen=set()
    for rel,(original,changed) in sources.items():
        if rel in seen or not rel.startswith('Code/server/src/space/'):
            raise ValueError('PF63_INVALID_REVIEW_PATH: '+rel)
        seen.add(rel)
        if changed==original:raise ValueError('PF62_EMPTY_NATIVE_TRANSFORM: '+rel)
        if not original.endswith('\n') or not changed.endswith('\n'):
            raise ValueError('PF63_STOCK_SOURCE_NEWLINE_REQUIRED: '+rel)
        sections.append(f'diff --git a/{rel} b/{rel}\n')
        sections.extend(difflib.unified_diff(original.splitlines(keepends=True),
                    changed.splitlines(keepends=True),fromfile='a/'+rel,tofile='b/'+rel))
    for rel,changed in (added or {}).items():
        if rel in seen or not rel.startswith(str(NATIVE_DIR)+'/') or \
           rel.endswith('/') or '/..' in rel or rel.startswith('/'):
            raise ValueError('PF63_INVALID_NEW_MODULE_PATH: '+rel)
        if not changed or not changed.endswith('\n'):
            raise ValueError('PF63_INVALID_NEW_MODULE_CONTENT: '+rel)
        seen.add(rel)
        sections.append(f'diff --git a/{rel} b/{rel}\nnew file mode 100644\n')
        sections.extend(difflib.unified_diff([],changed.splitlines(keepends=True),
                       fromfile='/dev/null',tofile='b/'+rel))
    return ''.join(sections)


def validate_paths(engine: Path, repo: Path, output: Path):
    engine=engine.resolve(); repo=repo.resolve(); output=output.resolve()
    if engine==repo or not (engine/'Code/server/src/space/npc/nativeNpcService.js').is_file():
        raise ValueError('PF62_NATIVE_FORK_CHECKOUT_REQUIRED')
    if (output==engine or output.is_relative_to(engine) or engine.is_relative_to(output)
        or output==repo or output.is_relative_to(repo) or repo.is_relative_to(output)):
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
    additions={str(NATIVE_DIR/name):source for name,source in modules.items()}
    patch=make_review_diff(sources,additions)
    git=shutil.which('git')
    if git is None: raise ValueError('PF62_GIT_REQUIRED_FOR_READ_ONLY_APPLY_CHECK')
    # Validate the complete patch WITHOUT editing either source checkout.
    # Do this BEFORE making the first output file, avoiding partial bundles on
    # source conflict (e.g., a native module already exists in the engine).
    with tempfile.TemporaryDirectory(prefix='pf63-native-check-') as tmp:
        scratch=Path(tmp)
        patch_file=scratch/'full.patch';patch_file.write_text(patch,encoding='utf-8')
        subprocess.run([git,'-C',str(engine),'apply','--check',str(patch_file)],
                       check=True,capture_output=True,text=True)
        # Independently prove that a real git apply (in an isolated throwaway
        # tree only) yields EVERY staged byte, not just the two stock files.
        for rel,(original,_) in sources.items():
            file=scratch/rel;file.parent.mkdir(parents=True,exist_ok=True)
            file.write_bytes(original.encode('utf-8'))
        subprocess.run([git,'-C',str(scratch),'init','-q'],check=True,
                       capture_output=True,text=True)
        subprocess.run([git,'-C',str(scratch),'apply',str(patch_file)],check=True,
                       capture_output=True,text=True)
        for rel,expected in [*((k,v[1]) for k,v in sources.items()),*additions.items()]:
            if (scratch/rel).read_bytes()!=expected.encode('utf-8'):
                raise ValueError('PF63_PATCH_ROUNDTRIP_CONTENT_MISMATCH: '+rel)
    # Source check and independently applied roundtrip passed; emit review files.
    output.mkdir(parents=True,exist_ok=True)
    created={}
    for rel,contents in [*((k,v[1]) for k,v in sources.items()),*additions.items()]:
        path=output/rel;path.parent.mkdir(parents=True,exist_ok=True)
        encoded=contents.encode('utf-8');path.write_bytes(encoded)
        created[rel]={'sha256':sha256(encoded),'bytes':len(encoded)}
    (output/'PF62-NATIVE-REVIEW.patch').write_text(patch,encoding='utf-8')
    created['PF62-NATIVE-REVIEW.patch']={'sha256':sha256(patch.encode()),'bytes':len(patch.encode())}
    if verify_syntax:compile_js(output,[Path(p) for p in created if p.endswith(".js")])
    manifest={
      'name':'PF62_NATIVE_REVIEW_BUNDLE','status':'NOT_INSTALLED_IN_EVEJS',
      'targetFork':'pas7-studio/EveJS coop/pas7std',
      'stockBlobs':{SERVICE:SERVICE_BLOB,STORE:STORE_BLOB},
      'featureEnabled':False,'gameplayE2E':'NOT_RUN',
      'patchIncludesAllModules':True,'patchAppliedOnlyInEphemeralVerifier':True,
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
