# Traffic collector contract

The frontend sends a real Plausible `pageview` for a public pathname navigation, including between two entity details in the same family. It suppresses re-renders of the same pathname. Query-only filters and fragments are not page transitions. The Privacy page honors and updates only Plausible's `plausible_ignore=true` browser storage flag, without a cookie or visitor ID. Global Privacy Control overrides the local preference.

Unknown public page paths map to the single `/_other` label. API, static and system paths are excluded from browser events. Deploy `traffic-contract.json` to the existing trusted browser ingress before switching the frontend, so the receiver accepts that same fixed label. No raw unknown path is transmitted. Consent controls, ad blockers, send failures and collector rejection mean browser analytics are not a complete HTTP request count.

- Public ingress: `POST /api/event` only, HTTPS, simple CORS text/plain with credentials and HTTP Referer omitted. Accept exact Atlas website Origins only for new browser pageviews. Forward `Sec-GPC`; an opt-out must never reach Plausible. No wildcard, cookie forwarding or client-supplied identity header.
- Pageview body: exactly `name: "pageview", domain: "stellaratlas.io", url: "https://stellaratlas.io" + path`, and optional `referrer`. Validate the exact path and the shared referrer policy in [traffic-contract.json](./traffic-contract.json); reconstruct the outbound body. A referrer is the original HTTP(S) scheme plus the ICANN registrable domain, never a subdomain, path, query, fragment, credential, non-default port, IP literal, internal suffix or opaque identifier-like registrable name. Use pinned `tldts@7.4.19` with `allowPrivateDomains: false` and require `isIcann === true` and `isIp !== true`; no DNS lookup. At ingress require the incoming referrer exactly equals the value reconstructed by the same policy, so `https://acct-92741123.customers.vendor.com` is rejected and `https://vendor.com` is accepted. Keep the six fixed browser custom actions in the existing ingress allowlist; they use the same trusted visitor headers. Keep API traffic out of this visitor site.
- Private CE 3.2.1 visitor input: the browser ingress accepts identity only on the protected Unix socket served by the authenticated Cloudflare tunnel, after deployment verifies the tunnel's provider route, connector access and client-IP overwrite behavior. Read exactly one validated `CF-Connecting-IP` there; reject duplicates, malformed addresses or lists. Rebuild the private collector request with the original bounded User-Agent and just one `X-Forwarded-For` from that verified address. Do not reuse inbound forwarding headers or send cookies, credentials or a raw referrer. Fail closed if the trusted hop is unavailable. Don't log or persist those headers outside Plausible's transient visitor calculation. The old fixed 120/min ingress cap was for sampled goal counters, not full site traffic. Replace it with bounded concurrency and overload handling sized and verified for actual traffic; report rejected, opted-out, overload and failed forwards separately. Never label accepted HTTP status alone a stored event.
- Confirm Pageviews, Visits, browser/device and referral breakdowns using controlled browser journeys, including two distinct record paths mapped to the same sanitized path. Test spoofed identity headers, GPC, local opt-out, private referrer values and unrelated origins. See the [Events API](https://plausible.io/docs/events-api) and the [pinned CE release](https://github.com/plausible/analytics/releases/tag/v3.2.1). No Cloud-only SDK features are required.

The public browser receiver's allowlist remains unchanged for server delivery. Older sampled server goals are historical; the API producer below talks directly to the existing private CE receiver and uses a separate operational site.

## API events in Plausible

Plausible is the primary API usage view. Create the separate site `api.stellaratlas.io`
in the existing CE dashboard and its case-sensitive custom event goal **API request**.
Keep this separate from human website adoption. At API runtime set
`ATLAS_API_PLAUSIBLE_ORIGIN=http://127.0.0.1:18080` only after verifying the API can
reach the existing same-host collector. The setting is absent by default; any other
destination fails configuration. No new dashboard/Stats key, public ingress,
Cloudflare credential or network daemon is needed. Keep the collector private.

The existing early observer enqueues one custom event for each HTTP response close,
including failed/aborted and unmatched requests. Scope is the instrumented origin
HTTP process, not edge-only traffic or WebSocket messages. HTTP 2xx is a transport
outcome, not proof of successful GraphQL execution. The exact CE event body is:

```json
{
  "name": "API request",
  "domain": "api.stellaratlas.io",
  "url": "https://api.stellaratlas.io/requests",
  "interactive": false,
  "props": {
    "route": "/v1/accounts/{account}",
    "method": "GET",
    "outcome": "2xx",
    "scope": "origin_http"
  }
}
```

`route` comes only from the reviewed OpenAPI template or a fixed fallback label;
method is fixed or `OTHER`, and outcome is one of the seven origin outcome buckets.
No account/contract value, query, body, key, request time, referrer or client header
is copied. Sends use only Content-Type and the honest fixed service user agent
`StellarAtlasAPIEvents/1.0`. No client-IP forwarding or synthetic browser identity.
These are nonidentifying service events irrespective of browser analytics consent;
browser GPC/local opt-out still controls the separate browser stream.

Use the custom goal's **total events/conversions**, not unique conversions, visitors,
visits, geography or device figures, for API volume. CE derives a synthetic producer
identity from the service request; it cannot measure API clients or human users here.
Register/use the fixed `route`, `method`, `outcome`, `scope` properties for breakdowns.
Repeated identical API calls emit repeated events, with no application deduplication.
CE assigns its receipt time; asynchronous delivery is not exact request-time history.

The producer keeps at most 1,024 pending events and eight active sends in RAM, with
no disk spool, per-request log or request-handler await. A scheduled pump does the
network work; each attempt has a two-second analytics-only deadline. Queued events
older than ten seconds expire. There is no bulk Events API: each event is one POST.
The only retry is once, after 250 ms, for local `ECONNREFUSED` before a connection
exists. No retry after timeouts/unknown delivery, HTTP rejections (including 429),
or CE drops: the API has no idempotency key and blind retries can duplicate events.
Graceful shutdown allows at most two seconds to drain, then aborts outstanding work.
Crashes, queue overflow, expiry and collector rejection can lose events; collection
is intentionally bounded and not lossless or a billing ledger.

Minute origin logs retain `plausibleDelivery` process-cumulative counters: `enqueued`,
`accepted`, `failed`, `collectorDropped`, `rejected`, `ambiguous`, `overloaded`,
`expired`, `retried`, `shutdownDropped`, `shutdownInFlight`, plus current `pending`
and `active`. Read counter deltas for the same process, never sum repeated cumulative
snapshots. `accepted` means CE returned 202 without a nonzero `x-plausible-dropped`;
it is not a storage receipt. Failures contain no raw errors, requests or identifiers.

The [Events API](https://plausible.io/docs/events-api) and pinned CE
[controller](https://github.com/plausible/analytics/blob/v3.2.1/lib/plausible_web/controllers/api/external_controller.ex),
[ingestion pipeline](https://github.com/plausible/analytics/blob/v3.2.1/lib/plausible/ingestion/event.ex)
and [request schema](https://github.com/plausible/analytics/blob/v3.2.1/lib/plausible/ingestion/request.ex)
establish the one-event request shape, bot/headless-browser drops, custom properties
and visitor hashing. Site rules can also drop events. Do not spoof a browser or
disable browser filtering globally to make a failing canary look successful.

### Controlled release verification

1. Qualify exact merged API source and the existing loopback receiver, create the
   separate site and API request goal, and verify no public collector route or
   browser allowlist changed. Keep old volumes and the normal HA release path.
2. Choose a quiet short UTC window and read a bounded baseline for this site's
   `API request` events, fixed route/method/outcome and `origin_http` scope. Do not
   log dashboard keys, source addresses or raw event payloads. Use an authorized
   dashboard or a small time/site-filtered read of the existing analytics store.
3. Send three ordinary requests to one documented read-only API endpoint through
   the real serving path. Confirm their original responses are unchanged. Check
   journal deltas for three enqueued, then accepted (or exact explicit failure
   counters) with zero pending/active. Background calls sharing that template must
   be accounted for; a status 202 alone is insufficient.
4. After CE's normal buffer/refresh delay, prove the stored **event** count increased
   by three in that controlled cohort and view the goal/property breakdown in the
   protected dashboard. Repeated payloads must produce three events, not one visitor.
   Confirm zero added pageviews in either site and no new browser-site API events.
5. Verify a controlled collector-unavailable local test leaves API responses intact
   and reports explicit delivery losses. No production outage is necessary: use the
   existing test injection. If the honest service UA is dropped, retain that failure
   as a release blocker; do not call those requests stored or switch to a fake UA.
6. Disable by unsetting only the producer runtime value and using the normal rolling
   release. Preserve reconciliation counters and stored analytics. Report any lost
   or ambiguous interval; do not fabricate backfilled events from aggregate totals.

## API operational traffic

Set `ATLAS_API_TRAFFIC_LOG=1` in the API runtime. Each API process aggregates all completed or disconnected HTTP requests that enter its Express observer, mounted before CORS, body parsing and routing. Reviewed OpenAPI routes use fixed method/path templates; other requests use only `UNMATCHED_ROUTE`, `UNSUPPORTED_METHOD` or `INVALID_PATH` (over 2,048 path characters, over 16 segments or unreadable/invalid path). Arbitrary request paths and methods never become labels. Each minute it emits at most one `atlas_public_api_traffic_v1` JSON line to the existing private service log. The fields are `from`, `to` (UTC), `deferredFlushes`, `http` (fixed labels → counts by 2xx, 3xx, 4xx, 5xx, 429, other or aborted), and `websocket` (attempted, accepted and app-policy-rejected upgrades by fixed path: `/v1/stream/data`, `/v1/live/ws`, `/v1/status/ws`). Each response is counted once on close, not again on finish. Malformed protocol handshakes rejected by the WebSocket library appear only as attempts. The 4xx bucket excludes 429. Heartbeats and messages are not counted. GraphQL errors returned with HTTP 200 count as HTTP 2xx, not successful operations; this observer does not inspect response bodies. Historical windows before this observer update omitted unmatched requests and cannot be retrospectively corrected from these aggregates. Socket/protocol errors rejected before Express and edge-only responses require separate evidence.

These origin aggregates are supplemental reconciliation for the Plausible API custom events above. Request/error totals include automation and browsers with analytics disabled; they contain no identities, raw paths, parameters, query text, payloads or headers. Sum process windows, not distinct visitors. Backpressure defers a single bounded aggregate; `deferredFlushes` reports delayed intervals, not lost requests. A forced exit can lose the last unflushed window. Remove the older sampled-goal `ATLAS_ANALYTICS_ORIGIN` setting; it is not the new `ATLAS_API_PLAUSIBLE_ORIGIN` producer setting. No new database, public endpoint or remote log sender is needed.

### Read a bounded operator report

On an authorized origin host, set `api_unit` to the API systemd unit and `from`/`to` to ISO UTC timestamps. Run from the deployed source tree:

```sh
journalctl --unit "$api_unit" --since "$from" --until "$to" --no-pager \
  --output=cat --lines=10000 --grep '^\{"type":"atlas_public_api_traffic_v1"' |
  node ops/analytics/read-api-traffic.mjs "$from" "$to"
```

This prints the requested range, the top 20 fixed route templates, HTTP outcome totals, and WebSocket handshakes. It reads at most 10,000 matching summaries and 32 MiB over a range of up to 31 days. Narrow the range if `inputLimited` is true or the journal command hits its record cap. The reader includes only complete process windows. Unobserved time may be idle or missing. Run the report for each serving origin before drawing conclusions.

### Protected API traffic dashboard

The analytics host entry links to the Plausible site dashboard and to
`/api-traffic`. Both entry and report paths require the existing administrator
access policy. The separate public browser event receiver keeps its existing
route and policy.

The refresh timer runs the existing reader against the serving API unit for
the past hour and day. Supply the method and path projection of the serving
generation's public OpenAPI document as `public-openapi.json` when installing
the scripts. Refresh that projection and the unit selection when changing API
generations. The refresh service atomically replaces one HTML snapshot on the
analytics data mount. The web service reads that snapshot over a private Unix
socket and has no journal access. A failed refresh leaves the last complete
snapshot and its original generation time.

Use the report to understand origin-process requests and HTTP outcomes,
including automation. GraphQL HTTP outcomes describe transport responses.
WebSocket attempts and outcomes appear separately. Edge traffic, visitor
counts, and GraphQL operation success require different measurements.

### Optional edge measurement

This optional code is not the primary API usage view. Leave its timer disabled;
no new Cloudflare analytics credential is required for the Plausible correction.

`edge-traffic.mjs` is a separate outbound-only fetch step. It queries the zone's
`httpRequestsAdaptiveGroups` for `requestSource: "eyeball"`: one total and at most
10 host/status/cache groups, plus a separate unfiltered request-source category
aggregate capped at 16 groups, for a rolling 24-hour closed UTC window ending on a
five-minute boundary at least ten minutes behind the clock. One POST per refresh,
ten-second deadline and 64 KiB response cap; no request URLs, IPs, referrers,
security-event rows or Worker invocation dataset is requested. Counts are
provider-reported, never multiplied by `sampleInterval`. The top groups are not
the separate total. Client `eyeball` requests, `inBrowserChallenge` traffic and
internal/subrequest categories remain separate; no combined client/unique total
is inferred. Missing source categories are unknown, not zero, and reaching the
16-group cap is flagged. Provider source names are mapped to the fixed documented
[ClientRequestSource categories](https://developers.cloudflare.com/logs/reference/clientrequestsource/),
with unknown categories collapsed to `other-source`. Adaptive sampling and
provider delay remain visible.

The optional five-minute unit requires a **separate narrow zone-analytics-read
credential**, supplied by systemd `LoadCredential` as `cloudflare-analytics-token`,
and `CF_ZONE_ID` in its protected environment file. Do not reuse workstation OAuth
or expose this credential to the browser collector, report renderer or server.
Provision its dedicated `atlas-edge-analytics` user with write access only to
`api-traffic/edge`, and renderer read access to the 0640 result. The existing
0700 `api-traffic` parent needs only an explicit traversal ACL for this UID;
do not make the parent or credentials group-readable or recursively chmod any
tree. Use a dedicated edge-owned child with the renderer's read group and a
root-only original provider credential; systemd copies it to this unit's private
credential directory. Credential
creation, filesystem ownership and timer activation are operator/release steps;
source installation alone does not establish live collection. Existing renderer
and serving units retain `PrivateNetwork=yes` and their AF_UNIX restriction.

The atomic `edge/traffic.json` envelope contains `state: ready|error`,
`checkedAtUtc`, and nullable `lastGood`. The sanitized last-good contract contains
`schemaVersion: 1`, `source: cloudflare_graphql_analytics`, `generatedAtUtc`,
`window` (from/to, inclusive/exclusive semantics, seconds, reporting lag), `edge`
(provider count, sampling, up to ten fixed-host/status/cache groups and sixteen
fixed request-source groups with a cap flag), and
`coverage` (delay/missing flags, unknown failover and WebSocket message counts).
Unknown zone hosts collapse to `other-zone-host`. Every refresh replaces this
one bounded file; it never accumulates equal windows or keeps old generations.
Failures retain the last measured snapshot marked stale; empty provider results
are unknown, not zero. Without the optional file the report says **Not yet
collecting**. The report marks collection older than twenty minutes stale.

Edge requests include requests that may also reach an origin, while browser
pageviews represent a different consent-sensitive measurement. Never add edge,
origin, visitor, Worker or security-event totals together. An edge cache status
does not identify the exact failover branch. The report is private, not an
adoption claim or exhaustive billing ledger.
