'use strict';
/**
 * Original EveJS source-bound PF56 dock readback.
 *
 * This is NOT the docking executor. PF66 moves the original title and detaches
 * the physical scene actor with one-shot durable attempts; PF60/PF61 separately
 * clean up native NPC rows. Only AFTER both can PF56 release the PF52 claim.
 * Never retry any side effect from this reader and never infer success merely
 * from the ship being in the station (a crash may leave an orphan controller).
 */
const itemStore = require('../services/inventory/itemStore');
const npcStore = require('./npc/nativeNpcStore');
const npcService = require('./npc/nativeNpcService');
const npcRegistry = require('./npc/npcRegistry');
const runtime = require('./runtime');
const scopedDock = require('./coopPersonalFleetScopedDock');
const terminal = require('./coopPersonalFleetTerminalCustody');
const cleanup = require('./coopPersonalFleetScopedNativeCleanup');
const pf56 = require('./coopPersonalFleetReturnDock');
const T = 'corporationRuntime';
const ITEMS = 'items';
const PREFIX = 'coop-personal-fleet\u001f';
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const positive = x => Number.isSafeInteger(x) && x > 0;
const hex = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const same = (x, row) => obj(x) &&
  x.assignmentID === row.assignmentID &&
  x.shipItemID === row.shipItemID &&
  x.ownerCharacterID === row.ownerCharacterID &&
  x.pilotID === row.pilotID &&
  x.systemID === row.systemID &&
  x.actorGeneration === row.actorGeneration;

function createOriginalDockCompletionWitness({ enabled = () => false,
  allWritersFenced = () => false, verifyFinalOriginalManifest } = {}) {
  if (typeof enabled !== 'function' || typeof allWritersFenced !== 'function' ||
    typeof verifyFinalOriginalManifest !== 'function' ||
    typeof pf56.manifestValid !== 'function' ||
    typeof itemStore.findItemById !== 'function' ||
    typeof npcStore.getNativeEntity !== 'function' ||
    typeof npcStore.getNativeController !== 'function' ||
    typeof npcStore.listNativeModulesForEntity !== 'function' ||
    typeof npcStore.listNativeCargoForEntity !== 'function' ||
    typeof npcRegistry.getControllerByEntityID !== 'function' ||
    typeof runtime.scenes?.values !== 'function' ||
    typeof scopedDock.valid !== 'function' ||
    typeof scopedDock.signature !== 'function' ||
    typeof scopedDock.attemptKey !== 'function' ||
    typeof scopedDock.sceneAttemptKey !== 'function' ||
    typeof terminal.terminalKey !== 'function' ||
    typeof terminal.terminalSignature !== 'function' ||
    typeof cleanup.attemptKey !== 'function' ||
    typeof cleanup.attemptSignature !== 'function')
    throw Error('PF_DOCK_COMPLETION_ORIGINAL_NATIVE_SOURCES_MISSING');

  function verifyOriginalDockReceipt(row, tx) {
    if (enabled() !== true || allWritersFenced() !== true ||
      npcService.PF66_SCOPED_DOCK_SCENE_DETACH_V1 !== true ||
      npcStore.PF61_SCOPED_ORIGINAL_NATIVE_CLEANUP_V1 !== true ||
      !obj(tx) || typeof tx.get !== 'function' ||
      !obj(row) || !scopedDock.valid(row)) return null;
    const c = {
      mode: 'DOCK', operationID: row.operationID,
      assignmentID: row.assignmentID,
      pilotID: row.pilotID, shipItemID: row.shipItemID,
      ownerCharacterID: row.ownerCharacterID, systemID: row.systemID,
      generation: row.reservationGeneration,
      actorGeneration: row.actorGeneration, typeID: row.typeID,
      stationID: row.stationID
    };
    try {
      const dock = tx.get(T, scopedDock.attemptKey(row.assignmentID));
      const sceneAttempt = tx.get(T, scopedDock.sceneAttemptKey(row.assignmentID));
      const term = tx.get(T, terminal.terminalKey(row.assignmentID));
      const nativeAttempt = tx.get(T, cleanup.attemptKey(row.assignmentID));
      const returnState = tx.get(T, PREFIX + 'return-dock-v1:' + row.assignmentID);
      const item = tx.get(ITEMS, String(row.shipItemID));
      if ([dock, sceneAttempt, term, nativeAttempt, returnState, item]
        .some(v => v === undefined || v === null)) return null;
      const dockSig = scopedDock.signature(row);
      const terminalSig = terminal.terminalSignature(c);
      if (!hex(dockSig) || !hex(terminalSig) ||
        !obj(dock) || dock.version !== 1 || dock.status !== 'CONSUMED' ||
        dock.signature !== dockSig || dock.assignmentID !== row.assignmentID ||
        dock.operationID !== row.operationID || dock.shipItemID !== row.shipItemID ||
        dock.actorGeneration !== row.actorGeneration ||
        dock.reservationGeneration !== row.reservationGeneration ||
        !positive(dock.committedAtMs) ||
        !obj(sceneAttempt) || sceneAttempt.version !== 1 ||
        sceneAttempt.status !== 'CONSUMED' ||
        sceneAttempt.assignmentID !== row.assignmentID ||
        sceneAttempt.shipItemID !== row.shipItemID ||
        sceneAttempt.actorGeneration !== row.actorGeneration ||
        sceneAttempt.reservationGeneration !== row.reservationGeneration ||
        sceneAttempt.dockAttemptSignature !== dockSig ||
        !positive(sceneAttempt.committedAtMs) ||
        !obj(term) || term.version !== 1 || term.phase !== 'NATIVE_CLEARED' ||
        term.dispatchCount !== 1 || term.signature !== terminalSig ||
        term.mode !== 'DOCK' || term.operationID !== row.operationID ||
        term.generation !== row.reservationGeneration ||
        term.typeID !== row.typeID || term.stationID !== row.stationID ||
        !same(term, row) || !hex(term.witnessHash) ||
        !obj(nativeAttempt) || nativeAttempt.version !== 1 ||
        nativeAttempt.status !== 'CONSUMED' ||
        nativeAttempt.assignmentID !== row.assignmentID ||
        nativeAttempt.operationID !== row.operationID ||
        nativeAttempt.shipItemID !== row.shipItemID ||
        nativeAttempt.generation !== row.reservationGeneration ||
        nativeAttempt.actorGeneration !== row.actorGeneration ||
        nativeAttempt.signature !== cleanup.attemptSignature(c, term) ||
        !positive(nativeAttempt.consumedAtMs) ||
        !obj(returnState) || returnState.phase !== 'DOCK_ISSUING' ||
        returnState.signature !== row.signature ||
        returnState.operationID !== row.operationID ||
        returnState.shipItemID !== row.shipItemID ||
        returnState.actorGeneration !== row.actorGeneration ||
        returnState.stationID !== row.stationID ||
        !obj(item) ||
        !scopedDock.stockShip(item, row, true))
        return null;
      const original = itemStore.findItemById(row.shipItemID);
      if (!scopedDock.stockShip(original, row, true)) return null;
      // A deleted scene actor is not enough: all persisted original native rows
      // and the live controller must ALSO have been removed by PF60/PF61.
      if (npcStore.getNativeEntity(row.shipItemID) !== null ||
          npcStore.getNativeController(row.shipItemID) !== null ||
          npcRegistry.getControllerByEntityID(row.shipItemID) !== null) return null;
      const modules = npcStore.listNativeModulesForEntity(row.shipItemID);
      const cargo = npcStore.listNativeCargoForEntity(row.shipItemID);
      if (!Array.isArray(modules) || modules.length !== 0 ||
          !Array.isArray(cargo) || cargo.length !== 0) return null;
      // The stock custody manifest must still prove every original fitting
      // and cargo title survived the transfer; empty native NPC rows alone
      // cannot establish this. PF56 independently checks it again on release.
      const manifest = verifyFinalOriginalManifest(row, tx);
      if (!pf56.manifestValid(manifest, row) ||
          JSON.stringify(manifest) !== JSON.stringify(row.manifest)) return null;
      // An UNMOUNTED system is not proof of a removed physical actor.
      // Restart/recovery must mount the original scene before readback.
      const sourceScene = runtime.scenes.get(row.systemID);
      if (!sourceScene || sourceScene.systemID !== row.systemID ||
          typeof sourceScene.getEntityByID !== 'function') return null;
      const scenes = [...runtime.scenes.values()];
      if (scenes.some(scene => !scene || typeof scene.getEntityByID !== 'function' ||
        scene.getEntityByID(row.shipItemID) != null)) return null;
      return Object.freeze({
        source: 'ORIGINAL_EVEJS_DOCK_COMPLETION_V1',
        operationID: row.operationID, signature: row.signature,
        assignmentID: row.assignmentID,
        ownerCharacterID: row.ownerCharacterID,
        pilotID: row.pilotID, shipItemID: row.shipItemID,
        stationID: row.stationID, systemID: row.systemID,
        actorGeneration: row.actorGeneration,
        originalItemStoreCommitted: true,
        nativeEntityAbsent: true,
        nativeControllerAbsent: true,
        noOtherLivePhysicalEntity: true,
        cargoAndFittingTitlesPreserved: true,
        sessionlessNativeDockReceiptPersisted: true
      });
    } catch { return null; }
  }
  return Object.freeze({verifyOriginalDockReceipt});
}
module.exports = Object.freeze({createOriginalDockCompletionWitness});
