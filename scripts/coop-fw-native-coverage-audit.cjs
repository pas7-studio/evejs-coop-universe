"use strict";
// Read-only exact pinned source contracts. A symbol/RPC is NOT gameplay.
const fs=require('node:fs'),path=require('node:path');
const ROOT='server/src/';
const CONTRACTS=Object.freeze({
 'services/corporation/fwCharacterEnlistmentMgrService.js':['Handle_CreateMyDirectEnlistment','Handle_RemoveMyDirectEnlistment','Handle_SetMyCorpAllowedEnlistmentFactions','updateCharacterRecord'],
 'services/character/standingRuntime.js':['getCharacterRawStanding','applyStandingChanges','setCharacterStanding'],
 'services/faction/facWarMgrService.js':['Handle_GetMyCharacterRankOverview','Handle_GetMyCharacterRankInfo'],
 'services/faction/fwVictoryPointMgrService.js':['Handle_GetAllVictoryPointStates','getSessionStateSource','DEFAULT_VICTORY_POINT_THRESHOLD'],
 'services/map/fwWarzoneSolarsystemService.js':['Handle_GetAllWarzonesOccupationStates','buildEmptyOccupationStatesByWarzone','Handle_GetLocalOccupationState'],
 'services/map/insurgencySolarsystemService.js':['VISIBLE_CAMPAIGN_SNAPSHOTS','Handle_GetAllVisibleCampaigns','Handle_GetLocalCampaignClientSnapshot'],
 '_secondary/express/gatewayServices/insurgencyGatewayService.js':['getPublicCorruptionSystemInfo','getPublicSuppressionSystemInfo','buildSystemInfo(0)'],
 '_secondary/express/gatewayServices/campaignGatewayService.js':['createCampaignGatewayService','responsePayloadBuffer: emptyPayload','statusCode: 200'],
 'services/corporation/lpWalletState.js':['adjustCharacterWalletLPBalance','getCharacterWalletLPBalance'],
 'services/evermarks/lpStoreMgrService.js':['LPStoreMgr','Handle_'],
 'services/dungeon/operationSiteRuntime.js':['module.exports'],
});
function readSources(codePath){const out={};for(const name of Object.keys(CONTRACTS)){
 try{out[name]=fs.readFileSync(path.join(path.resolve(codePath),ROOT,name),'utf8');}
 catch(e){if(e.code!=='ENOENT')throw e;out[name]=null;}}
 return out;}
function auditSources(sources={}) {
 const files={};for(const [file,tokens] of Object.entries(CONTRACTS)) {
  const source=sources[file];files[file]={state:typeof source!=='string'?'MISSING':
   tokens.every(x=>source.includes(x))?'SOURCE_CONTRACT_PRESENT':'DRIFTED',
   missingTokens:typeof source!=='string'?tokens:tokens.filter(x=>!source.includes(x))};
 }
 const ok=(...names)=>names.every(name=>files[name]?.state==='SOURCE_CONTRACT_PRESENT');
 const paths={
  directEnlistment:{state:ok('services/corporation/fwCharacterEnlistmentMgrService.js')?'NATIVE_MUTATION_UNGUARDED':'SOURCE_UNVERIFIED',gameplayVerified:false},
  factionStandings:{state:ok('services/character/standingRuntime.js')?'NATIVE_RAW_STANDINGS_AVAILABLE':'SOURCE_UNVERIFIED',gameplayVerified:false},
  ranks:{state:ok('services/faction/facWarMgrService.js')?'READ_ONLY_PRESENT':'SOURCE_UNVERIFIED',gameplayVerified:false},
  victoryPoints:{state:ok('services/faction/fwVictoryPointMgrService.js')?'INJECTED_READ_STATE_NO_CAPTURE_SETTLEMENT':'SOURCE_UNVERIFIED',gameplayVerified:false},
  occupation:{state:ok('services/map/fwWarzoneSolarsystemService.js')?'EMPTY_WARZONE_OCCUPATION':'SOURCE_UNVERIFIED',gameplayVerified:false},
  pirateInsurgencies:{state:ok('services/map/insurgencySolarsystemService.js','_secondary/express/gatewayServices/insurgencyGatewayService.js')?'STATIC_CAMPAIGN_AND_ZERO_PROGRESS_STUB':'SOURCE_UNVERIFIED',gameplayVerified:false},
  lpWallets:{state:ok('services/corporation/lpWalletState.js')?'NATIVE_WALLET_NO_FW_CREDIT_PROVEN':'SOURCE_UNVERIFIED',gameplayVerified:false},
  militaryCampaigns2026:{state:ok('_secondary/express/gatewayServices/campaignGatewayService.js')?'EMPTY_GATEWAY_NO_OBJECTIVE_ENGINE':'SOURCE_UNVERIFIED',gameplayVerified:false},
  fwCaptureSites:{state:'NO_VERIFIED_PINNED_SITE_COMPLETION_AUTHORITY',gameplayVerified:false},
 };
 return {pin:'c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f',
  classification:'PINNED_SOURCE_CONTRACT_ONLY',files,paths,
  safety:{inventedVP:false,inventedLP:false,syntheticTerritory:false,syntheticMilitaryCampaigns:false},
  evidence:{clientLogin:false,twoClientBattle:false,nativeCapture:false,lpSettlement:false,serverRestart:false}};
}
if(require.main===module){try{
 if(process.argv.length!==4||process.argv[2]!=='--code-path')throw Error('usage: node scripts/coop-fw-native-coverage-audit.cjs --code-path <pinned EveJS/Code>');
 const report=auditSources(readSources(process.argv[3]));console.log(JSON.stringify(report,null,2));
 if(Object.values(report.files).some(x=>x.state!=='SOURCE_CONTRACT_PRESENT'))process.exitCode=2;
}catch(e){console.error('FW_NATIVE_AUDIT_ERROR:',e.message);process.exitCode=2;}}
module.exports={CONTRACTS,readSources,auditSources};
