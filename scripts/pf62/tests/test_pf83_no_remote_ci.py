"""PF83: honor the owner's manual-only GitHub Actions prohibition."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[3]

class ManualOnlyCiTests(unittest.TestCase):
    def test_no_remote_ci_workflow(self):
        workflows = ROOT / '.github' / 'workflows'
        active = ([p for p in workflows.rglob('*') if p.is_file() and
                   p.suffix in ('.yml', '.yaml')] if workflows.is_dir() else [])
        self.assertEqual(active, [], f'REMOTE_CI_FORBIDDEN: {active}')

    def test_owner_policy_present(self):
        agreement = (ROOT / 'AGENTS.md').read_text(encoding='utf8')
        self.assertIn('CI prohibition', agreement)
        self.assertIn('Do not add, restore, enable or run GitHub Actions workflows', agreement)

if __name__ == '__main__':
    unittest.main()
