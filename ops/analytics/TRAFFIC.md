# Traffic collector contract

The frontend sends a real Plausible `pageview` for a public pathname navigation, including between two entity details in the same family. It suppresses re-renders of the same pathname. Query-only filters and fragments are not page transitions. The Privacy page honors and updates only Plausible's `plausible_ignore=true` browser storage flag, without a cookie or visitor ID. Global Privacy Control overrides the local preference.

- Public ingress: `POST /api/event` only, HTTPS, simple CORS text/plain with credentials and HTTP Referer omitted. Accept exact Atlas website Origins only for new browser pageviews. Forward `Sec-GPC`; an opt-out must never reach Plausible. No wildcard, cookie forwarding or client-supplied identity header.
- Pageview body: exactly `name: "pageview", domain: "stellaratlas.io", url: "https://stellaratlas.io" + path`, and optional `referrer`. Validate the exact path and the shared referrer policy in [traffic-contract.json](./traffic-contract.json); reconstruct the outbound body. A referrer is the original HTTP(S) scheme plus the ICANN registrable domain, never a subdomain, path, query, fragment, credential, non-default port, IP literal, internal suffix or opaque identifier-like registrable name. Use pinned `tldts@7.4.19` with `allowPrivateDomains: false` and require `isIcann === true` and `isIp !== true`; no DNS lookup. At ingress require the incoming referrer exactly equals the value reconstructed by the same policy, so `https://acct-92741123.customers.vendor.com` is rejected and `https://vendor.com` is accepted. Keep the six fixed browser custom actions in the existing ingress allowlist; they use the same trusted visitor headers. Keep API traffic out of this visitor site.
- Private CE 3.2.1 visitor input: the browser ingress accepts identity only on the protected Unix socket served by the authenticated Cloudflare tunnel, after deployment verifies the tunnel's provider route, connector access and client-IP overwrite behavior. Read exactly one validated `CF-Connecting-IP` there; reject duplicates, malformed addresses or lists. Rebuild the private collector request with the original bounded User-Agent and just one `X-Forwarded-For` from that verified address. Do not reuse inbound forwarding headers or send cookies, credentials or a raw referrer. Fail closed if the trusted hop is unavailable. Don't log or persist those headers outside Plausible's transient visitor calculation. The old fixed 120/min ingress cap was for sampled goal counters, not full site traffic. Replace it with bounded concurrency and overload handling sized and verified for actual traffic; report rejected, opted-out, overload and failed forwards separately. Never label accepted HTTP status alone a stored event.
- Confirm Pageviews, Visits, browser/device and referral breakdowns using controlled browser journeys, including two distinct record paths mapped to the same sanitized path. Test spoofed identity headers, GPC, local opt-out, private referrer values and unrelated origins. See the [Events API](https://plausible.io/docs/events-api) and the [pinned CE release](https://github.com/plausible/analytics/releases/tag/v3.2.1). No Cloud-only SDK features are required.

The same public HTTPS endpoint may retain the previous four server event shapes only during rollout compatibility, but this successor no longer emits them. Retire that compatibility after both origin pools have switched; historical goal counts must not be read as current API traffic.

## API operational traffic

Set `ATLAS_API_TRAFFIC_LOG=1` in the API runtime. Each API process aggregates completed or disconnected requests whose method and path match the reviewed public OpenAPI paths, including REST, GraphQL, and documented RPC. Each minute it emits at most one `atlas_public_api_traffic_v1` JSON line to the existing private service log. The fields are `from`, `to` (UTC), `deferredFlushes`, `http` (fixed method and OpenAPI path template → counts by 2xx, 3xx, 4xx, 5xx, 429, other or aborted), and `websocket` (attempted, accepted and app-policy-rejected upgrades by fixed path: `/v1/stream/data`, `/v1/live/ws`, `/v1/status/ws`). Malformed protocol handshakes rejected by the WebSocket library appear only as attempts. The 4xx bucket excludes 429. Heartbeats and messages are not counted. GraphQL errors returned with HTTP 200 are not HTTP failures. Unmatched/private routes and undocumented upstream paths are outside the origin counters; add edge measurements separately for cache hits or failures that never reach the origin.

No API request is sent to Plausible. API request/error totals count service use, including automation and browsers with analytics disabled; they contain no identities, raw paths, parameters, query text, payloads or headers. Sum process windows, not distinct visitors. Backpressure defers a single bounded aggregate; `deferredFlushes` reports delayed intervals, not lost requests. A forced exit can lose the last unflushed window; this is operational evidence, not a billing-grade ledger. Remove the old `ATLAS_ANALYTICS_ORIGIN` API runtime value after the change. No new database, API endpoint, or remote log sender is needed.

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

Use the report to understand documented origin requests and HTTP outcomes,
including automation. GraphQL HTTP outcomes describe transport responses.
WebSocket attempts and outcomes appear separately. Edge traffic, visitor
counts, and GraphQL operation success require different measurements.
