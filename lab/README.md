# Two-session laboratory (standalone)

This is an independent Node.js TCP testing fixture, **not EveJS game networking**. It tests two distinct TCP connections, identities, basic event broadcast, duplicate account rejection, and disconnect cleanup. Its server binds only to `127.0.0.1`.

Requires Node.js 20+; no npm packages or copyrighted client/game artifacts.

```powershell
node --test .\lab\co-op-session-lab.test.mjs
```

Tests use an ephemeral loopback port, and do not expose any game ports. Optional manual loopback fixture: `node lab/co-op-session-lab.mjs` (port 28000).

**What passing tests mean:** the standalone harness works. **What they do not mean:** EveJS accepts two players; VPN, the game protocol, XMPP, market, CCP client or NPC integration works. These require upstream code audits, permissions, and separate testing.
