# Initial EveJS networking source evidence

Status: **partial upstream audit**, based on publicly visible source files, not an executed network test. Date: 2026-10-24.

## Confirmed source findings

1. [EveJS Code/compose.yaml](https://github.com/gameboys84/EveJS/blob/main/Code/compose.yaml) sets `EVEJS_GAME_SERVER_BIND_HOST=0.0.0.0` **inside the container**, but all host-facing published ports are bound to **127.0.0.1**. That distinction is security-critical.
2. The same compose file advertises `EVEJS_GAME_SERVER_HOST=127.0.0.1`, `EVEJS_IMAGE_SERVER_URL=http://127.0.0.1:26001/`, `EVEJS_MICROSERVICES_PUBLIC_BASE_URL=http://127.0.0.1:26002/`, and `EVEJS_MICROSERVICES_REDIRECT_URL=http://127.0.0.1:26002/`. XMPP sets `EVEJS_XMPP_CONNECT_HOST=localhost`. A TCP tunnel only on 26000 will not address those redirects/resources.
3. Published localhost ports: host `443 -> container 26003`, `5222 -> 5222`, `26000 -> 26000`, `26001 -> 26001`, `26002 -> 26002`; market health `40110 -> 40110` stays localhost-only. Market backend RPC uses internal port `40111`.
4. [EveJS Code/Play.bat](https://github.com/gameboys84/EveJS/blob/main/Code/Play.bat) validates `start.ini` so `server`/`serverip` equals `127.0.0.1`, validates `cryptoPack=Placebo`, and contains client `blue.dll` patch-validation/auto-patching logic. This creates a **hard launcher compatibility gate**, not just an externally configurable server address; modifications to proprietary client may violate CCP terms.
5. `Play.bat` also applies client network policy, checks local server/proxy readiness, and trusts an installed CA; simply forwarding a raw game socket cannot guarantee working resources or TLS/XMPP.

## Unverified and must inspect before any co-op work

- All game listener code paths and exact advertised server info packets.
- Protocol-level IP/hostname literals in responses, resource URLs, image APIs, WebSockets/XMPP/HTTPS.
- Whether two distinct client sessions are already supported on one instance; account and character locks, ownership and state isolation.
- TLS hostname/SNI requirements and certificate trust without prohibited client modification.
- Security threat model for exposing an originally localhost-only emulator even inside VPN.
- Licensing/permission to modify or use the original EVE client for remote private multiplayer.

## Architectural conclusion

**Do not change Docker host port publishing, `start.ini`, or `blue.dll` now.** Implement only server-side tests and code audit until legal/security boundaries are established. Keep the current localhost-only setup as the default. When permitted, design a private gateway + endpoint advertisement strategy and verify every protocol dependency.

## Concrete next task

COOP-010: pin an upstream commit; record every `EVEJS_*HOST` / `*_URL` use with file/line references, external listeners, login and XMPP flows; add a standalone integration harness for two synthetic server sessions that does not require or modify the proprietary game client. Document client compatibility as a separate gate.
