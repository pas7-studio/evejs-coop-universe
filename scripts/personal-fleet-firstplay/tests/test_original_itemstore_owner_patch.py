"""PF107 original ItemStore source transformer guardrails (no native build)."""
import importlib.util
import tempfile
from pathlib import Path
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "tools/build_original_itemstore_owner_patch.py"
spec = importlib.util.spec_from_file_location("pf107_itemstore_patch", SCRIPT)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

# Exact source anchors from original EveJS Code/server/src/services/inventory/itemStore.js.
# This fixture exercises the transformer, not original Node or SQLite.
FIXTURE = '''const { performance } = require("perf_hooks");
function readItems() {
  if (itemsTableCache) {
    return itemsTableCache;
  }
}
function writeItems(data, options = {}) {
  const { indexDelta, ...dbOptions } = options;
  const writeResult = repo.write(ITEMS_TABLE, "/", data, dbOptions);
  if (writeResult && writeResult.success) {
    return true;
  }
  return false;
}
function writeItemCustomInfo(itemID, customInfo, options = {}) {
  return repo.write(ITEMS_TABLE, `/${String(itemID)}/customInfo`, customInfo, options);
}
function stockRefineryMutation() {
  const items=JSON.parse(JSON.stringify(readItems()));
}
function originalOreTransfer() {
  const items=JSON.parse(JSON.stringify(current));
}
if (process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS === "1") module.exports.coopInvalidateAfterAtomicRows = mode => { if(mode === "probe") return true; itemIndexesDirty = true; itemIndexesCache = null; itemIndexKeys = new Map(); reservedItemIDBatch = []; itemMutationVersion += 1; return true; };
'''


class PF107StockItemStorePatchTest(unittest.TestCase):
    def test_stock_source_still_has_exact_single_owner_chokepoints(self):
        patched = m.transform(FIXTURE)
        self.assertEqual(patched.count("function readItems()"), 1)
        self.assertEqual(patched.count("function writeItems(data, options = {})"), 1)
        self.assertEqual(patched.count("function writeItemCustomInfo(itemID, customInfo, options = {})"), 1)
        self.assertIn('pf107Gateway().executeOriginalStockRoot({', patched)
        self.assertEqual(patched.count('pf107Gateway().executeOriginalStockRoot({'), 2)

    def test_pf_guarded_read_detaches_before_mutating_original_cache(self):
        patched = m.transform(FIXTURE)
        start = patched.index("function readItems()")
        cache = patched.index("  if (itemsTableCache)", start)
        self.assertLess(patched.index("return detached", start), cache)
        self.assertIn("pf107ReadSnapshots.set(detached, expected)", patched)

    def test_original_stock_write_is_not_replayed_after_atomic_success(self):
        patched = m.transform(FIXTURE)
        start = patched.index("function writeItems(")
        native = patched.index("executeOriginalStockRoot(", start)
        original = patched.index('repo.write(ITEMS_TABLE, "/", data, dbOptions)', start)
        self.assertLess(native, original)
        self.assertIn('if (outcome?.status !== "COMMITTED") return false;', patched)
        self.assertIn('const expectedOriginalRoot = pf107ReadSnapshots.get(data);', patched)
        self.assertIn('expectedOriginalRoot });', patched)

    def test_metadata_subpath_also_routes_through_original_atomic_owner(self):
        patched = m.transform(FIXTURE)
        start = patched.index("function writeItemCustomInfo(")
        self.assertIn("expectedOriginalRoot: pf107ReadSnapshots.get(items)", patched)
        self.assertLess(patched.index("executeOriginalStockRoot(", start),
                        patched.index("return repo.write(ITEMS_TABLE,", start))

    def test_refinery_and_ore_copy_snapshots_remain_bound_under_personal_fleet(self):
        patched = m.transform(FIXTURE)
        self.assertIn('    ?readItems():JSON.parse(JSON.stringify(readItems()));', patched)
        self.assertIn('    ?current:JSON.parse(JSON.stringify(current));', patched)
        self.assertEqual(patched.count('process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE === "1"'),
                         5)

    def test_original_game_store_atomic_invalidation_drops_root_cache(self):
        patched = m.transform(FIXTURE)
        marker = patched.index("coopInvalidateAfterAtomicRows")
        self.assertIn("itemsTableCache = null;", patched[marker:])

    def test_modified_or_missing_source_anchor_is_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "PF107_ORIGINAL_ITEMSTORE_ANCHOR_DRIFT"):
            m.transform(FIXTURE.replace("function readItems() {", "function migratedReadItems() {"))

    def test_second_stock_owner_chokepoint_is_forbidden(self):
        with self.assertRaisesRegex(ValueError, "PF107_ORIGINAL_ITEMSTORE_ANCHOR_DRIFT"):
            m.transform(FIXTURE + 'function readItems() {\n  if (itemsTableCache) {\n}\n')

    def test_unpinned_stock_blob_is_not_patched(self):
        with tempfile.TemporaryDirectory() as folder:
            engine = Path(folder)
            target = engine / m.TARGET
            target.parent.mkdir(parents=True)
            target.write_text(FIXTURE, encoding="utf-8")
            # The original sqliteStore blob is independently required.
            with self.assertRaisesRegex(ValueError, "PF108_ORIGINAL_SQLITE_STORE_NOT_FOUND"):
                m.build(engine)
            self.assertEqual(target.read_text(encoding="utf-8"), FIXTURE)

    def test_unpinned_itemstore_refuses_after_original_sqlite_layout_pin(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as folder:
            engine = Path(folder)
            target = engine / m.TARGET
            target.parent.mkdir(parents=True)
            target.write_text(FIXTURE, encoding="utf-8")
            with patch.object(m, "verify_original_item_sqlite_layout"):
                with self.assertRaisesRegex(ValueError, "PF107_ORIGINAL_ITEMSTORE_SOURCE_BLOB_DRIFT"):
                    m.build(engine)

    def test_unpinned_original_sqlite_store_rejected_before_any_itemstore_patch(self):
        with tempfile.TemporaryDirectory() as folder:
            engine = Path(folder)
            target = engine / m.STOCK_SQLITE_STORE
            target.parent.mkdir(parents=True)
            target.write_text("const ROW_GROUPS = { items: ['items'] };", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "PF108_ORIGINAL_SQLITE_SOURCE_BLOB_DRIFT"):
                m.verify_original_item_sqlite_layout(engine)

    def test_stock_writer_patch_builder_does_not_accept_symlink(self):
        with tempfile.TemporaryDirectory() as folder:
            engine = Path(folder)
            target = engine / m.TARGET
            target.parent.mkdir(parents=True)
            real = engine / "real-itemstore.js"
            real.write_text(FIXTURE, encoding="utf-8")
            try:
                target.symlink_to(real)
            except (OSError, NotImplementedError):
                self.skipTest("symlink creation unavailable")
            with self.assertRaisesRegex(ValueError, "PF107_ORIGINAL_ITEMSTORE_MISSING_OR_SYMLINK"):
                m.build(engine)


    def _pf110_verify_schema(self, groups):
        import hashlib
        from unittest.mock import patch
        source = (
            'const ROW_GROUPS = {\n' + groups + '\n};\n' +
            'function explodeToRows(table, object) {}\n' +
            'function rowGroupsFor(table) {\n' +
            ' return ROW_GROUPS[table] || null;\n}\n'
        )
        with tempfile.TemporaryDirectory() as folder:
            engine = Path(folder)
            target = engine / m.STOCK_SQLITE_STORE
            target.parent.mkdir(parents=True)
            raw = source.encode("utf-8")
            target.write_bytes(raw)
            digest = hashlib.sha1(
                b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw
            ).hexdigest()
            with patch.object(m, "STOCK_SQLITE_BLOB", digest):
                m.verify_original_item_sqlite_layout(engine)

    def test_pf110_original_actors_grouped_and_player_wallet_flat(self):
        self._pf110_verify_schema(
            '  npcEntities: ["entities"],\n  npcModules: ["modules"],')

    def test_pf110_group_shape_drift_denies_work_patch(self):
        with self.assertRaisesRegex(ValueError, "PF110_ORIGINAL_NATIVE_GROUP_LAYOUT_UNVERIFIED"):
            self._pf110_verify_schema('  npcEntities: ["entities"],')

    def test_pf110_player_character_aggregate_drift_denies_work_patch(self):
        with self.assertRaisesRegex(ValueError, "PF110_ORIGINAL_NATIVE_FLAT_LAYOUT_UNVERIFIED"):
            self._pf110_verify_schema(
                '  npcEntities: ["entities"],\n  npcModules: ["modules"],\n'
                '  characters: ["records"],')


if __name__ == "__main__":
    unittest.main()
