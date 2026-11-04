# StellarAtlas adoption analytics

The Atlas-only Compose project uses [Plausible Community Edition 3.2.1](https://github.com/plausible/analytics/releases/tag/v3.2.1). Its Postgres and ClickHouse instances live on a dedicated internal network with dedicated volumes. Keep the raw Plausible collector on host loopback and administer it through approved private access.

Supply the following through an operator-owned environment file outside Git:

- `ATLAS_ANALYTICS_BASE_URL` is the HTTPS origin of the approved ingress.
- `ATLAS_ANALYTICS_SECRET_KEY_BASE` is an independently generated Plausible secret, at least 64 bytes long.
- `ATLAS_ANALYTICS_DB_PASSWORD` is an independently generated, URL-safe Postgres password. Use hex characters to avoid escaping in the database URL.
- `ATLAS_ANALYTICS_LOCAL_PORT` optionally overrides port 18080.

From this directory use `docker compose --env-file /path/to/private.env config --quiet` to validate, and `docker compose --env-file /path/to/private.env up -d` on the approved isolated host. Follow [CE setup](https://github.com/plausible/community-edition/tree/v3.2.1) to bootstrap the private admin and add the `stellaratlas.io` site. Configure custom event goals named **Documentation use**, **Archive inspection**, and **Successful event query**. Keep the dashboard private unless a separate sharing decision authorizes it.

Before enabling the browser producer, provision a separate approved HTTPS ingress. It must accept only the exact three named event shapes and reconstruct the canonical name, URL and domain from its own allowlist before forwarding. Reject unknown fields, paths and event names. Bound body size and rate, and keep access logs free of event bodies, referrer URLs, cookies and client identifiers. A generic proxy to Plausible's event endpoint would bypass the payload boundary. The current Compose project supplies no public ingress.

Once that ingress is verified, set `NEXT_PUBLIC_ATLAS_ANALYTICS_ORIGIN` at frontend build time to its HTTPS origin without a trailing slash. The browser submits only the documentation entry or a loaded archive inventory, once per mount. It omits referrers and credentials, respects Global Privacy Control, and uses the browser's normal network IP and user agent as described by the [Events API](https://plausible.io/docs/events-api). No analytics script observes page URLs, searches or form contents.

Set `ATLAS_ANALYTICS_ORIGIN` in the API runtime to an approved HTTPS origin or a same-host HTTP origin at `127.0.0.1`, without a trailing slash. The API emits a fixed success event after the typed REST contract-event response finishes. This is an operation count. API events carry a fixed service user agent and are attributed to the service's network address. They cannot measure distinct API clients. Browser events and API events have separate names. Direct GraphQL requests and legacy event routes are outside this initial event.

Both producers are disabled when their origin is unset. Each permits two in-flight sends, with a two-second deadline and no queue or retries. The only event fields are a fixed name, a fixed canonical URL and the site domain. Test that each custom event actually appears in CE after staging. HTTP 202 can also mean a dropped event. Confirm that failed or slow ingestion leaves Atlas response behavior intact before enabling either producer in production. To disable, remove the API setting and rebuild the frontend without its public setting. Preserve existing analytics volumes during rollback.
