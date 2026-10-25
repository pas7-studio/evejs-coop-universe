"use strict";
// Reversible, pinned-source-only fix. Strict opt-in mining writes always use
// EXISTING nativeNpcStore.upsertNativeCargo and its ID allocator. No second
// store or ore generator is added.
const marker="function appendNpcMiningCargo(entity, typeID, quantity) {";
const oldWrite="  nativeNpcStore.upsertNativeCargo({";
const newWrite="  return nativeNpcStore.upsertNativeCargo({";
const guard=[
 '  if (process.env.EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY === "1")',
 '    return coopAppendNpcMiningCargoStrict(entity, typeID, quantity);'
].join("\n")+"\n";
const strict=String.raw