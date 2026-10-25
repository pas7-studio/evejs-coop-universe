import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const code=process.env.EVEJS_COOP_CODE_PATH;
const cases=[
 ['pre-debit command center network guard', 'server/src/services/planet/planetMgrService.js',
  '    const constructionDebit = debitPIWallet({'],
 ['pre-commit launch orphan guard', 'server/src/services/planet/planetMgrService.js',
  '    const preview = planetRuntimeStore.previewLaunchCommodities(launchOptions);'],
 ['post-launch physicalized cargo proof', 'server/src/services/planet/planetMgrService.js',
  '    createPhysicalLaunchContainer(result.launch, session);'],
 ['PI GM commodity creation denial', 'server/src/services/planet/planetMgrService.js',
  '  Handle_GMAddCommodity(args, session) {'],
 ['PI expired launch GM cleanup denial', 'server/src/services/planet/planetMgrService.js',
  '  Handle_GMCleanupExpiredLaunches(args, session) {'],
 ['customs office and colony system/planet proof', 'server/src/services/inventory/invBrokerService.js',
  '    const importInfo = this._buildPIImportCommoditiesFromItems('],
 ['customs settings ownership check', 'server/src/services/planet/planetOrbitalRegistryBrokerService.js',
  '    const result = planetOrbitalState.updateOrbitalSettings(orbitalID, {']
];
for(const [description,file,anchor] of cases){
 test(description,t=>{
  if(!code){t.skip('Pinned EveJS Code checkout not mounted; source verified separately via GitHub');return;}
  const abs=path.join(code,file);
  if(!fs.existsSync(abs)){t.skip('Pinned source file absent');return;}
  const source=fs.readFileSync(abs,'utf8');
  assert.equal(source.split(anchor).length-1,1,'Native anchor drifted: '+file);
 });
}
