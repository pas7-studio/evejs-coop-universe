# Real EveJS session-registry contract tests

This repository now tests **the real upstream `Code/server/src/services/chat/sessionRegistry.js` module**, with two synthetic session objects and no proprietary EVE client.

## Run on your computer

```powershell
cd C:\Games\EveCoopProject
$env:EVEJS_CODE_PATH='C:\Games\EveCoop\upstream-evejs\Code'
node --test .\tests\upstream-session-registry.test.mjs
```

CI fetches pinned upstream commit `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`. Local runs use the checkout you downloaded, which may be a different version. Record `git -C C:\Games\EveCoop\upstream-evejs rev-parse HEAD` with test output.

Covered: two distinct character sessions in the registry, disconnect/unregister isolation, duplicate character preferred-session selection, and character reindex behavior.

**Limits:** this does NOT exercise the handshake, account authentication, visibility/scene replication, combat, fleet gameplay, XMPP or a real co-op game client. Two sessions being supported by a registry is a *necessary but insufficient* condition for two-player gameplay. Remote/VPN game networking remains off and blocked pending permissions and security assessment.

Source: [sessionRegistry.js](https://github.com/gameboys84/EveJS/blob/c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f/Code/server/src/services/chat/sessionRegistry.js).
