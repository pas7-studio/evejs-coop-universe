# Co-op Architecture — technical specification (proposal)

## Goal and scope

Two humans join **one** persistent authoritative EveJS world, optionally populated by X-Eve NPC pilots. A friend's machine runs **client only**. The host runs simulation, game sessions, chat, market and database. This is client/server carried by a private VPN, **not** peer-to-peer distributed simulation.

```text
Host PC (Windows 11)                            Friend PC
+---------------------------------+              +-----------------+
| EveJS game / chat / assets      |              | Game client     |
| Living Universe (optional)      |              | VPN endpoint    |
| Market / SQLite / NPC state     |              +--------+--------+
| Local client (optional)         |                       |
| VPN-only gateway [NOT BUILT] <--+------ private VPN ----+
+---------------------------------+
```

## Baseline reality

Upstream README explicitly limits access to `127.0.0.1`; Docker publishes loopback ports. **There is no verified support for WAN, LAN, Tailscale or two separate PCs.** Networking proposal below is only a specification. It must be approved for legal and security compliance before any remote-client EVE deployment.

## Proposed layers

1. **Endpoint inventory:** inspect real listeners, protocol bootstrap, redirects, encoded addresses, HTTP(S) and XMPP callbacks. Produce file:line evidence with tests before coding.
2. **Address separation:** `listenHost` != `advertisedHost`. Keep localhost default; expose strictly scoped gateway if permissible. Avoid wildcard binding.
3. **Transport:** Tailscale/WireGuard network ACLs to exactly two authenticated devices. Raw TCP proxy cannot solve embedded localhost addresses or TLS certificate identity; protocol-dependent traffic may require additional design.
4. **Session isolation:** distinct accounts, independent character/session IDs, simultaneous login without overwriting singleton state, reconnect/logout/timeout handling.
5. **Single shared world:** both players map to the same system instance; visibility/events consistent; server owns simulation and validates commands. No trust in client-reported inventory, wallet or damage.
6. **Trust boundaries:** HTTPS/XMPP/game protocol auth, replay and rate limiting, bind address controls, private admin/market endpoints, conservative logs, secure certificate management.
7. **Lifecycle:** host shutdown and loss of VPN disconnect the friend cleanly; durable data persists; relaunch and reconnection do not duplicate transactions.

## Example *future* config contract (NOT implemented)

```json
{
  "mode": "localhost",
  "game": { "listenHost": "127.0.0.1", "listenPort": 26000 },
  "network": {
    "privateCoopEnabled": false,
    "allowedVpnPeers": [],
    "externalEndpoint": null
  },
  "admin": { "listenHost": "127.0.0.1" }
}
```

Only enable remote mode after permission and negative tests. Never enable via a single blind string replacement. Use runtime validation to reject public IP/interface binding and empty allowlists.

## VPN smoke testing without game client

Testing VPN routing is distinct from exposing EveJS. Once both devices join the same approved VPN, check Tailscale connectivity and try an **independent, disposable TCP echo service** on a non-game test port. Do not publish `26000`, `443`, `5222`, market health or databases as part of the smoke test. Verify connection, disconnect/reconnect, wrong peer denied, and firewall default deny.

## Explicit acceptance tests

- Two separate authenticated players online concurrently without leaking one another's account state.
- Both see the same grid, locations and NPC materializations; every world action has one authoritative result.
- Fleet/warp/dock/trade/combat/chat tested separately; unsupported features documented, not faked.
- Network failure and host restart lead to safe cleanup and persisted state.
- Unauthorized peer and non-VPN Internet connectivity refused.
- Admin/market/DB interfaces inaccessible to guest clients.
- P95 world tick measured with 2 players + NPC load; X-Eve docs call ~100ms tick nominal, 120ms warning, 130ms load-test ceiling. Capture hardware and config.

## Risks and hard stops

- **Legal:** client use/modification and remote private server need appropriate authorization. Do not bypass client security, DRM, anti-cheat or authentication.
- **Security:** upstream expressly warns against network exposure. Keep original localhost mode as only runnable default.
- **Compatibility:** X-Eve only patches one exact baseline, and advertised addresses may be hardcoded in multiple protocols.
- **Completeness:** NPCs in Local are not proof of functional mining/fleet/combat/trading; test end-to-end.

Code architecture decisions should be revisited after a file-level audit of a pinned upstream commit.
