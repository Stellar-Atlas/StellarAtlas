# StellarAtlas analytics

The existing self-hosted [Plausible Community Edition 3.2.1](https://github.com/plausible/analytics/releases/tag/v3.2.1) serves two distinct measurements:

- `stellaratlas.io`: browser pageviews and six fixed product actions, with GPC/local opt-out and sanitized page/referral labels.
- `api.stellaratlas.io`: asynchronous **API request** custom events from the API process, with fixed route, method and HTTP outcome properties. Use total events/conversions, never this service producer's visitors/visits, as request volume.

Follow the [traffic collector contract](./TRAFFIC.md) for configuration, privacy boundaries, bounded delivery, failure counters and request-to-stored-event qualification. The existing minute origin aggregates remain reconciliation evidence, not a substitute for the API site in Plausible. No Cloudflare analytics credential is required for these API events. Optional edge-source code is not the primary usage view and should remain disabled unless separately admitted.

## Deployment boundary

The Atlas-only Compose project keeps its PostgreSQL and ClickHouse stores on its existing dedicated internal network and admitted analytics mount. Keep the raw collector's existing port bound to `127.0.0.1:18080`; expose neither it nor its databases publicly. Administer the dashboard through the existing protected access policy. Do not change its browser event ingress allowlist to admit server traffic.

Supply the existing Compose settings outside Git: `ATLAS_ANALYTICS_BASE_URL`, `ATLAS_ANALYTICS_SECRET_KEY_BASE`, a URL-safe `ATLAS_ANALYTICS_DB_PASSWORD`, and the already admitted `ATLAS_ANALYTICS_VOLUME_ROOT`. Never put these values in source or logs. Registration remains invite-only; preserve analytics volumes during upgrades and rollback.

At API runtime, `ATLAS_API_PLAUSIBLE_ORIGIN=http://127.0.0.1:18080` enables the local producer. An unset value disables it; other destinations fail configuration. This assumes the API process can reach the existing same-host collector; qualify that topology before setting it. No dashboard/Stats API key is required for `POST /api/event`. Keep `ATLAS_API_TRAFFIC_LOG=1` for reconciliation. Removing the producer setting stops future emissions without a frontend rebuild.

The frontend continues to use its existing build-time `NEXT_PUBLIC_ATLAS_ANALYTICS_ORIGIN` and trusted browser receiver contract. Its six custom goals are Documentation use, Archive inspection, Network view, Explorer list view, Explorer record view and Explorer search submitted. The older sampled server goals are historical and must not be mistaken for the new comprehensive origin-request custom event.
