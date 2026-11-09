# StellarAtlas adoption analytics

The Atlas-only Compose project uses [Plausible Community Edition 3.2.1](https://github.com/plausible/analytics/releases/tag/v3.2.1). Its Postgres and ClickHouse instances live on a dedicated internal network with dedicated volumes. Keep the raw Plausible collector on host loopback and administer it through approved private access.

Supply the following through an operator-owned environment file outside Git:

- `ATLAS_ANALYTICS_BASE_URL` is the HTTPS origin of the approved ingress.
- `ATLAS_ANALYTICS_SECRET_KEY_BASE` is an independently generated Plausible secret, at least 64 bytes long.
- `ATLAS_ANALYTICS_DB_PASSWORD` is an independently generated, URL-safe Postgres password. Use hex characters to avoid escaping in the database URL.
- `ATLAS_ANALYTICS_LOCAL_PORT` optionally overrides port 18080.

From this directory use `docker compose --env-file /path/to/private.env config --quiet` to validate, and `docker compose --env-file /path/to/private.env up -d` on the approved isolated host. Follow [CE setup](https://github.com/plausible/community-edition/tree/v3.2.1) to bootstrap the private admin and add the `stellaratlas.io` site. Keep the dashboard private unless a separate sharing decision authorizes it.

Run `node ingress.mjs` on the same host as the collector. This starts a separate loopback listener on port 18081. Use `ATLAS_ANALYTICS_INGRESS_PORT` to change the port and `ATLAS_ANALYTICS_COLLECTOR_ORIGIN` to point at the private collector's loopback origin. It accepts only the canonical event shapes below and reconstructs their payloads before forwarding. It drops `Sec-GPC: 1`, caps bodies at 512 bytes, and admits at most 4 concurrent and 120 submissions per minute per ingress process.

Before enabling the browser producer, use an approved TLS proxy to expose only the validated ingress path `POST /api/event`. Preserve its CORS response headers; the browser uses a simple text/plain CORS request and the ingress allows only the Atlas web origins (no wildcard or credentials). Keep logs free of event bodies, referrer URLs, cookies and client identifiers. A generic proxy to Plausible's event endpoint would bypass the payload boundary. This project supplies the loopback listener and leaves TLS and external routing to the operator.

### Goals and coverage

Configure exactly these case-sensitive custom event goals for the product signal rollout. The URL sent to Plausible is always `https://stellaratlas.io` plus the fixed path shown.

| Goal | Fixed path | Records |
| --- | --- | --- |
| Documentation use | `/docs` | Documentation entry |
| Archive inspection | `/archives` | Loaded archive inventory |
| Network view | `/overview` | Navigation into the graph, overview, nodes or organizations category |
| Explorer list view | `/explorer` | Navigation into the explorer list category |
| Explorer record view | `/explorer` | Navigation into a recognized explorer detail route, not proof a record exists |
| Explorer search submitted | `/explorer` | Search accepted by the form validator, not proof of a match |
| Successful event query | `/explorer/contract-events` | Finished HTTP 200 typed REST contract-event query |
| Public REST use | `/docs/api` | Finished HTTP 200 GET on the transactions, operations or ledgers detail, account balances or asset holders routes under `/v1/analytics` |
| Public GraphQL use | `/docs/graphql` | Finished HTTP 200 POST with a successful, directly selected warehouse data field |
| Public WebSocket connection | `/docs/live-updates` | Accepted connection on `/v1/stream/data` after its ready frame is queued |

The browser observes route categories locally; it does not send paths, identifiers, queries, referrers, or credentials. Routes within one category do not generate another event, and each event has a three-second cooldown per tab. Both browser Global Privacy Control and API `Sec-GPC: 1` opt out. API signals cover a programmatic subset: requests with browser Origin, Referer or fetch-metadata headers are not counted, including HTTP clients that set those headers. GraphQL discovery, status, validation/execution errors, and operations selecting data only through top-level fragments are not counted. Legacy REST, health, background polling by the app, SCP, heartbeat frames and individual WebSocket messages are not instrumented. Programmatic callers on the covered routes are indistinguishable from their own automation; do not use these counts as unique visitors, comprehensive request volume, or uptime.

### Release order

1. Update and validate the ingress first; the original three payload shapes remain compatible. Add the listed goals in the private dashboard. The browser producer must use CORS mode: the previous no-CORS request with redirect rejection can fail before reaching a cross-origin collector.
2. Set `NEXT_PUBLIC_ATLAS_ANALYTICS_ORIGIN` at frontend build time to the approved HTTPS origin without a trailing slash. Set `ATLAS_ANALYTICS_ORIGIN` at API runtime to the approved HTTPS ingress or same-host validated loopback HTTP origin. Both producers are disabled when their setting is unset.
3. Verify controlled actions reach the matching private goals and that opted-out actions do not. An [Events API](https://plausible.io/docs/events-api) HTTP 202 response does not confirm storage. Confirm collector failure leaves application responses unchanged before rollout.

Each producer permits two in-flight sends with a two-second analytics-only deadline, no queue, and no retries. API budgets are process-local: up to 12 attempts per minute per REST/GraphQL goal and one WebSocket attempt per 30 seconds. The ingress forwards a fixed user agent, not browser IP addresses or user agents. The only forwarded event fields are a fixed name, a fixed canonical URL and the site domain. To disable the producers, remove the API setting and rebuild the frontend without its public setting. Preserve the analytics volumes during rollback.
