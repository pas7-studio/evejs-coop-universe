import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createAuthority}=require('../integration/coopPlayerCorporationAccess.cjs');
const {patch}=require('../scripts/coop-player-corporation-access-patch.cjs');
const CORP=980001,OTHER=980002,HQ=60000101,REMOTE=60000102;
const HANGAR=115,TAKE_1=8192n,QUERY_1=1048576n,TAKE_WALLET_1=134217728n;
function world(){
 const corp=new Map([[CORP,{corporationID:CORP,isNPC:false,ceoID:111,stationID:HQ}],
  [OTHER,{corporationID:OTHER,isNPC:false,ceoID:999,stationID:REMOTE}]]);
 const characters=new Map([[111,{characterID:111,corporationID:CORP}],
  [222,{characterID:222,corporationID:CORP}],
  [333,{characterID:333,corporationID:OTHER}]]);
 const members=new Map([[111,{characterID:111,corporationID:CORP,roles:'0',isCEO:true,rolesAtHQ:'0'}],
  [222,{characterID:222,corporationID:CORP,roles:'0',rolesAtHQ:'0',rolesAtBase:'0',rolesAtOther:'0',baseID:REMOTE}],
  [333,{characterID:333,corporationID:OTHER,roles:'0',rolesAtHQ:'0'}]]);
 const offices=new Map([[CORP,[{officeID:9901,officeFolderID:9902,stationID:HQ,impounded:false}]],
  [OTHER,[{officeID:9903,stationID:REMOTE,impounded:false}]]]);
 const items=new Map([[9000,{itemID:9000,ownerID:222,locationID:HQ,flagID:4}],
  [9001,{itemID:9001,ownerID:CORP,locationID:9901,flagID:HANGAR,categoryID:6}],
  [9002,{itemID:9002,ownerID:333,locationID:REMOTE,flagID:4}],
  [9003,{itemID:9003,ownerID:CORP,locationID:9901,flagID:4,categoryID:6}],
  [9004,{itemID:9004,ownerID:222,locationID:9000,flagID:5}]]);
 const docked=new Map([[111,HQ],[222,HQ],[333,REMOTE]]);
 const runtime=new Map([[CORP,{applications:{'500':{applicationID:500,corporationID:CORP,characterID:333,status:0,deleted:false},'501':{applicationID:501,corporationID:CORP,characterID:333,status:8,deleted:false}}}]]);
 const auth=createAuthority({getCorporation:id=>corp.get(id)||null,getMember:(corpID,id)=>members.get(id)?.corporationID===corpID?members.get(id):null,
  getCharacter:id=>characters.get(id)||null,getOffices:id=>offices.get(id)||[],
  getDockedStation:s=>docked.get(s.characterID),getItem:id=>items.get(id)||null,
  getDirectorRole:()=>1n,getPersonnelRole:()=>2n,getRentRole:()=>4n,getRuntime:id=>runtime.get(id)||null});
 const session=id=>({characterID:id,corporationID:characters.get(id)?.corporationID??0,
  corprole:((1n<<60n)-1n).toString(),rolesAtHQ:((1n<<60n)-1n).toString(),
  corpAccountKey:1000,fleetID:777,wingID:1});
 const move=(s,id,dest={locationID:HQ,flagID:4})=>auth.authorizeInventoryMove({session:s,
  sourceItemDescriptor:{sourceKind:'inventory',item:items.get(id)},destination:dest});
 return {corp,characters,members,offices,items,docked,runtime,auth,session,move};
}
test('CEO can create/use all seven native asset and wallet divisions',()=>{
 const w=world(),s=w.session(111);
 assert.equal(w.auth.isMember(s,CORP),true);
 for(let f=115;f<=121;f++){
  assert.equal(w.auth.canTake(s,CORP,HQ,f),true);
  assert.equal(w.auth.canView(s,CORP,HQ,f),true);
 }
 for(let k=1000;k<=1006;k++)assert.equal(w.auth.canWallet(s,CORP,k),true);
 assert.equal(w.auth.canIndustry(s,CORP),true);
});
test('unprivileged second member can join but cannot withdraw ISK or corporate items',()=>{
 const w=world(),s=w.session(222);
 assert.equal(w.auth.isMember(s,CORP),true);
 assert.equal(w.auth.canWallet(s,CORP,1000),false);
 assert.equal(w.auth.canTake(s,CORP,HQ,HANGAR),false);
 assert.equal(w.move(s,9001),false);
 assert.equal(w.auth.canIndustry(s,CORP),false);
});
test('donation into same-station office transfers real item, not wallet or fleet entitlement',()=>{
 const w=world(),s=w.session(222);
 assert.equal(w.move(s,9000,{locationID:9901,flagID:115}),true);
 assert.equal(w.move(s,9004,{locationID:9901,flagID:115}),true);
 assert.equal(w.move(s,9000,{locationID:9903,flagID:115}),false);
});
test('member with exact take right accesses ONLY assigned hangar division',()=>{
 const w=world(),s=w.session(222);
 w.members.get(222).rolesAtHQ=TAKE_1.toString();
 assert.equal(w.auth.canTake(s,CORP,HQ,115),true);
 assert.equal(w.auth.canTake(s,CORP,HQ,116),false);
 assert.equal(w.auth.canView(s,CORP,HQ,115),false);
 assert.equal(w.move(s,9001),true);
 assert.equal(w.move(s,9003),false);
});
test('hangar view without take cannot withdraw a ship or any asset',()=>{
 const w=world(),s=w.session(222);
 w.members.get(222).rolesAtHQ=QUERY_1.toString();
 assert.equal(w.auth.canView(s,CORP,HQ,115),true);
 assert.equal(w.auth.canTake(s,CORP,HQ,115),false);
 assert.equal(w.move(s,9001),false);
});
test('factory manager only can use industry and corp deliveries, not hangar take or cash',()=>{
 const w=world(),s=w.session(222);
 w.members.get(222).roles='1024';
 assert.equal(w.auth.canIndustry(s,CORP),true);
 assert.equal(w.auth.canBlueprint(s,CORP),true);
 assert.equal(w.auth.canTake(s,CORP,HQ,62),true);
 assert.equal(w.auth.canTake(s,CORP,HQ,115),false);
 assert.equal(w.auth.canWallet(s,CORP,1000),false);
});
test('corporate wallet spending requires persisted wallet take role, not corpAccountKey',()=>{
 const w=world(),s=w.session(222);
 assert.equal(w.auth.canWallet(s,CORP,1000),false);
 w.members.get(222).roles=TAKE_WALLET_1.toString();
 assert.equal(w.auth.canWallet(s,CORP,1000),true);
 assert.equal(w.auth.canWallet(s,CORP,1001),false);
 assert.equal(w.auth.canWallet(s,CORP,NaN),false);
});
test('fleet membership and stale session privileges cannot impersonate a corporation member',()=>{
 const w=world(),s=w.session(222);
 w.members.delete(222);
 assert.equal(w.auth.isMember(s,CORP),false);
 assert.equal(w.auth.canWallet(s,CORP,1000),false);
 assert.equal(w.move(s,9001),false);
});
test('character leaving corp immediately invalidates old persisted member and roles',()=>{
 const w=world(),s=w.session(222);
 w.members.get(222).roles=TAKE_WALLET_1.toString();
 w.characters.get(222).corporationID=OTHER;
 assert.equal(w.auth.isMember(s,CORP),false);
 assert.equal(w.auth.canWallet(s,CORP,1000),false);
});
test('foreign corporation and another player assets never become personal cargo',()=>{
 const w=world(),s=w.session(222);
 assert.equal(w.move(s,9002),false);
 assert.equal(w.auth.canTake(s,OTHER,REMOTE,115),false);
 assert.equal(w.move(w.session(333),9001),false);
});
test('director-only non-division corporate ship is protected from ordinary division members',()=>{
 const w=world(),s=w.session(222);
 w.members.get(222).rolesAtHQ=TAKE_1.toString();
 assert.equal(w.move(s,9003),false);
 assert.equal(w.move(w.session(111),9003),true);
});
test('docked requirement and impounded office prevent remote donations',()=>{
 const w=world(),s=w.session(222);
 w.docked.set(222,REMOTE);
 assert.equal(w.move(s,9000,{locationID:9901,flagID:115}),false);
 w.docked.set(222,HQ);w.offices.get(CORP)[0].impounded=true;
 assert.equal(w.move(s,9000,{locationID:9901,flagID:115}),false);
});
test('CEO label alone is not authority: canonical corporation ceoID required',()=>{
 const w=world(),s=w.session(222);w.members.get(222).isCEO=true;
 assert.equal(w.auth.canWallet(s,CORP,1000),false);
});
test('unknown or malformed item owner must never authorize a native owner transfer',()=>{
 const w=world(),s=w.session(222);
 assert.equal(w.auth.authorizeInventoryMove({session:s,sourceItemDescriptor:{sourceKind:'inventory',item:{itemID:23,ownerID:0}},destination:{locationID:9901,flagID:115}}),false);
 assert.equal(w.auth.authorizeInventoryMove({session:s,sourceItemDescriptor:{sourceKind:'nativeWreck',item:{itemID:23}},destination:{locationID:HQ,flagID:4}}),true);
});
function fixtureIndustry(){return [
'function isCorporationOwner(session, ownerID) {','  return getSessionCorporationID(session) === toInt(ownerID, 0);','}',
'function canSeeCorporationBlueprints(session, ownerID) {','  const corpRole = normalizeRoleValue(session && session.corprole);','  return (corpRole & CORP_BLUEPRINT_VIEW_MASK) !== 0n;','}',
'function hasCorporationIndustryJobAccess(session, ownerID) {','  const corpRole = normalizeRoleValue(session && session.corprole);','  return (corpRole & ROLE_FACTORY_MANAGER) === ROLE_FACTORY_MANAGER;','}',
'  const queryRole = CORP_HANGAR_QUERY_ROLE_BY_FLAG[toInt(flagID, 0)];',
'  const takeRole = CORP_HANGAR_TAKE_ROLE_BY_FLAG[toInt(flagID, 0)];',
'  const normalizedAccountKey = toInt(accountKey, 1000);'
].join('\n');}
function fixtureBroker(){return [
'    const sourceItem = sourceItemDescriptor.item;','    const groupingContext = {',
'    const requiredRole = CORP_HANGAR_QUERY_ROLE_BY_FLAG.get(numericFlag);',
'    if (','      !sourceItem ||','      this._normalizeInventoryId(sourceItem.categoryID, 0) !== CHARGE_CATEGORY_ID ||',
'      this._validateMoonMaterialBaySourceAccess(session, item);'
].join('\n');}
test('reversible native industry access patch preserves default-OFF original and canary',()=>{
 const s=fixtureIndustry(),t=patch(s,'industryAccess.js');
 assert.ok(t.includes('coopPlayerCorporationAccess'));
 assert.ok(t.includes('canWallet(session, ownerID, accountKey)'));
 assert.ok(t.includes('canIndustry(session, ownerID)'));
 assert.equal(patch(t,'industryAccess.js'),t);
 assert.equal(patch(t,'industryAccess.js',true),s);
});
test('reversible inventory patch protects Add MultiAdd DeliverToCorpHangar at shared writer',()=>{
 const s=fixtureBroker(),t=patch(s,'invBrokerService.js');
 assert.ok(t.includes('authorizeInventoryMove({session,sourceItemDescriptor,destination})'));
 assert.ok(t.includes('_isTransferSourceLocationMatch(sourceItemDescriptor, sourceLocationID)'));
 assert.ok(t.includes('return {handled:true,success:false,errorMsg:"CORPORATE_ASSET_ACCESS_DENIED"}'));
 assert.ok(t.includes('this._isCorporationHangarFlag(numericFlag)'));
 assert.equal(patch(t,'invBrokerService.js',true),s);
});
test('native patch is LF/CRLF reversible and rejects partial or unknown source',()=>{
 for(const [file,s] of [['industryAccess.js',fixtureIndustry()],['invBrokerService.js',fixtureBroker()]]){
  const crlf=s.replace(/\n/g,'\r\n');
  assert.equal(patch(patch(crlf,file),file,true),crlf);
  const needle=file==='industryAccess.js'?'  const normalizedAccountKey = toInt(accountKey, 1000);':'    const requiredRole = CORP_HANGAR_QUERY_ROLE_BY_FLAG.get(numericFlag);';
  assert.throws(()=>patch(s.replace(needle,''),file),/CH31_SOURCE_PARTIAL_OR_UNKNOWN|CH31_PINNED_ANCHOR_DRIFT/);
 }
 assert.throws(()=>patch('foo','malicious.js'),/CH31_UNSUPPORTED_PINNED_SOURCE/);
});
test('only authorized personnel manager or director can invite another character',()=>{
 const w=world(),member=w.session(222),director=w.session(111);
 assert.equal(w.auth.canRecruit(member,CORP),false);
 assert.equal(w.auth.canRecruit(director,CORP),true);
 w.members.get(222).roles='2';
 assert.equal(w.auth.canRecruit(member,CORP),true);
 assert.equal(w.auth.canManageMembers(member,CORP),false);
});
test('unprivileged actor cannot assign corporate rights or change another member',()=>{
 const w=world(),member=w.session(222);
 assert.equal(w.auth.canManageMembers(member,CORP),false);
 assert.equal(w.auth.canExecuteActions(member,CORP,[]),false);
 assert.equal(w.auth.canManageMembers(w.session(111),CORP),true);
});
test('native member cash/share actions remain fenced without durable atomic receipt',()=>{
 const w=world(),director=w.session(111);
 assert.equal(w.auth.canExecuteActions(director,CORP,[{verb:3,property:'roles',value:'0'}]),true);
 assert.equal(w.auth.canExecuteActions(director,CORP,[{verb:4,property:6,value:100}]),false);
 assert.equal(w.auth.canExecuteActions(director,CORP,[{verb:4,property:7,value:1}]),false);
});
test('applicant cannot unilaterally accept unapproved application into a corporation',()=>{
 const w=world(),applicant=w.session(333);
 assert.equal(w.auth.canUpdateApplication(applicant,CORP,500,333,2),false);
 assert.equal(w.auth.canUpdateApplication(applicant,CORP,501,333,2),true);
 assert.equal(w.auth.canUpdateApplication(applicant,CORP,501,222,2),false);
});
test('recruiter cannot change another applicants invitation into unauthorized join',()=>{
 const w=world(),member=w.session(222),director=w.session(111);
 assert.equal(w.auth.canUpdateApplication(member,CORP,500,333,6),false);
 assert.equal(w.auth.canUpdateApplication(director,CORP,500,333,6),true);
 assert.equal(w.auth.canUpdateApplication(director,CORP,501,333,2),false);
 assert.equal(w.auth.canUpdateApplication(director,CORP,500,222,6),false);
});
test('foreign applicant can reject their own invitation but not impersonate someone else',()=>{
 const w=world(),applicant=w.session(333);
 assert.equal(w.auth.canUpdateApplication(applicant,CORP,501,333,3),true);
 assert.equal(w.auth.canUpdateApplication(applicant,CORP,500,333,7),true);
 w.runtime.get(CORP).applications['501'].deleted=true;
 assert.equal(w.auth.canUpdateApplication(applicant,CORP,501,333,3),false);
});
test('office rental right does not confer wallet withdrawal or division access',()=>{
 const w=world(),s=w.session(222);
 w.members.get(222).roles='4';
 assert.equal(w.auth.canRent(s,CORP),true);
 assert.equal(w.auth.canWallet(s,CORP,1000),false);
 assert.equal(w.auth.canManageMembers(s,CORP),false);
});
test('revoked personnel rights immediately stop further invitations',()=>{
 const w=world(),s=w.session(222);
 w.members.get(222).roles='2';
 assert.equal(w.auth.canRecruit(s,CORP),true);
 w.members.get(222).roles='0';
 assert.equal(w.auth.canRecruit(s,CORP),false);
});
function fixtureCorpRegistry(){return [
'  Handle_UpdateApplicationOffer(args, session) {',
'    const customMessage = normalizeText(args && args[5], "");',
'  Handle_InsertInvitation(args, session) {','    const corporationID = resolveCorporationID(session);',
'  Handle_UpdateMember(args, session) {','    const corporationID = resolveCorporationID(session);',
'  Handle_SetCorpWelcomeMail(args, session) {','    const corporationID = resolveCorporationID(session);',
'  Handle_GetMyGrantableRoles(args, session) {','    const corporationID = resolveCorporationID(session);',
'  Handle_UpdateDivisionNames(args, session) {','    const corporationID = resolveCorporationID(session);'
].join('\n');}
function fixtureMemberActions(){return '  const walletKey = resolveSourceWalletKey(session, corporationID);';}
function fixtureOffice(){return ['function sessionCanRentOffice(session) {','function ensureCanUnrentOffice(session) {'].join('\n');}
test('recruiting/roles/native invitation RPC source patch is reversible and guarded',()=>{
 const base=fixtureCorpRegistry(),source=patch(base,'corpRegistryRuntime.js');
 assert.match(source,/canUpdateApplication\(session,corporationID,applicationID,characterID,status\)/);
 assert.match(source,/canRecruit\(session,corporationID\)/);
 assert.match(source,/canManageMembers\(session,corporationID\)/);
 assert.equal(patch(source,'corpRegistryRuntime.js',true),base);
});
test('corporate cash/share grants fail closed pending native atomic settlement',()=>{
 const base=fixtureMemberActions(),source=patch(base,'corpMemberActionState.js');
 assert.match(source,/canExecuteActions\(session,corporationID,actions\)/);
 assert.match(source,/CORPORATION_MEMBER_ACTION_NOT_AUTHORIZED_OR_NOT_ATOMIC/);
 assert.equal(patch(source,'corpMemberActionState.js',true),base);
});
test('office rental privileges are rechecked from persisted member roles',()=>{
 const base=fixtureOffice(),source=patch(base,'officeManagerService.js');
 assert.match(source,/canRent\(session,resolveCorporationID\(session\)\)/);
 assert.match(source,/canManageMembers\(session,resolveCorporationID\(session\)\)/);
 assert.equal(patch(source,'officeManagerService.js',true),base);
});
test('all additional native corporation source hooks reject torn patch and preserve CRLF',()=>{
 for(const [filename,source] of [['corpRegistryRuntime.js',fixtureCorpRegistry()],
  ['corpMemberActionState.js',fixtureMemberActions()],['officeManagerService.js',fixtureOffice()]]){
  const crlf=source.replace(/\n/g,'\r\n');
  assert.equal(patch(patch(crlf,filename),filename,true),crlf);
  const transformed=patch(source,filename);
  assert.equal(patch(transformed,filename),transformed);
  assert.throws(()=>patch(source.slice(0,source.length-8),filename),/CH31_SOURCE_PARTIAL_OR_UNKNOWN|CH31_PINNED_ANCHOR_DRIFT/);
 }
});
