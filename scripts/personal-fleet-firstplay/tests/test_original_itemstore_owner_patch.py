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
        self.assertLess(patched.index("return structuredClone(original.data)", start), cache)

    def test_original_stock_write_is_not_replayed_after_atomic_success(self):
        patched = m.transform(FIXTURE)
        start = patched.index("function writeItems(")
        native = patched.index("executeOriginalStockRoot(", start)
        original = patched.index('repo.write(ITEMS_TABLE, "/", data, dbOptions)', start)
        self.assertLess(native, original)
        self.assertIn('if (outcome?.status !== "COMMITTED") return false;', patched)

    def test_metadata_subpath_also_routes_through_original_atomic_owner(self):
        patched = m.transform(FIXTURE)
        start = patched.index("function writeItemCustomInfo(")
        self.assertLess(patched.index("executeOriginalStockRoot(", start),
                        patched.index("return repo.write(ITEMS_TABLE,", start))

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
            with self.assertRaisesRegex(ValueError, "PF107_ORIGINAL_ITEMSTORE_SOURCE_BLOB_DRIFT"):
                m.build(engine)
            self.assertEqual(target.read_text(encoding="utf-8"), FIXTURE)

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


if __name__ == "__main__":
    unittest.main()
