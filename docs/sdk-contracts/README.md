# SDK workflow contract fixtures

Status: **design fixtures for review**, pinned to
[source a3f537b0](https://github.com/Stellar-Atlas/StellarAtlas/tree/a3f537b03945bacf8a573c21131a2ac64c9d7e34).
This packet supports the first gate in the [builders SDK plan](../builders-sdk-plan.md).
It supplies synthetic request/response examples and language design constraints.
There is no generated client, installable SDK or package release.

## Scope and reproduction

The three workflows are account balance observations, issued-asset holders and
typed transaction detail with independent operation, effect and event pages.
Fixtures use a page size of one to expose continuation and termination clearly.
Addresses, hashes, timestamps and records are synthetic test data, not captured
production samples or evidence that an account or transaction exists on chain.

With the repository's locked development dependencies installed, run from its root:

```sh
NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --config docs/sdk-contracts/jest.config.mjs --runInBand
```

Contract tests are read-only: they never save HTTP responses or update fixtures,
including when an environment variable requests fixture updates. For a deliberate
contract refresh, review the source change and expected wire behavior first,
then edit the intended committed fixture files explicitly and review every diff.
Refresh their digest manifest with
`node docs/sdk-contracts/refresh-manifest.mjs <reviewed-source-revision>` and rerun
the unchanged comparisons. Never replace fixtures solely to silence a failure.

The tests invoke registered REST handlers directly and rerun GraphQL through the
actual public route mount, Express and locked `graphql-http` adapter. Separate
checks exercise the selected REST namespaces through that same public mount.
Synthetic warehouse services feed rows through existing query parsers and cursor
validation. Inert catalogue services disable background refresh and external
lookups; the database manager fails if called. Each HTTP request owns an ephemeral
loopback listener, closes it before returning and publishes no public port.
No warehouse, RPC or external service is queried.
Elapsed time is normalized to zero and the observation clock is fixed for stable
comparisons; these values are not performance or freshness measurements.

The real adapter executes the registered schema, validation rules and resolvers;
schema introspection also passes through HTTP. The negotiation matrix below
records the tested error phases and media types. The suite does not test a
database execution plan, production configuration, proxy/TLS behavior or SQL
correctness against a running warehouse.

[OpenAPI selection](fixtures/openapi-selected.json) retains the selected operations
and their referenced schemas from the existing document builders. Component
schemas are compacted for review. [GraphQL selection](fixtures/schema.graphql)
retains the three fields and reachable types; tests execute the full registered
schema. [Schema digests](fixtures/schema-digests.json) and the [manifest](manifest.json)
pin the full GraphQL schema digest, selected artifacts and contract source files.

## Wire and language mappings

These are proposed client representations. Rust and Go clients have not been
implemented or compiled by this packet. Retain the original response alongside
normalized workflow models; a successful parse alone is not compatibility proof.

| Wire value or behavior | TypeScript design | Rust design | Go design |
| --- | --- | --- | --- |
| Account, full `CODE:ISSUER` asset, hash, cursor | `string`; preserve identity and cursor bytes | `String`; no implicit issuer selection | `string`; no implicit issuer selection |
| Transaction IDs, sequence, raw amounts, exact trust-line limit | `string`; optional checked `bigint`, never `Number` | `String`; optional checked integer/decimal conversion | `string`; optional `math/big.Int` conversion |
| REST holder `as_of_ledger`, range `1..4294967295` | validated integer `number` | checked `u32` | checked `uint32` |
| GraphQL `asOfLedger`; typed transaction ledger hint in both transports | validated integer `1..2147483647` | checked positive `i32` range | checked positive `int32` range |
| Account REST `observedLedger`/`lastModifiedLedger` | validated UInt32 `number` | `u32` | `uint32` |
| Same account fields in GraphQL | schema `Int!`; values above signed32 produce errors | preserve GraphQL error, no truncation | preserve GraphQL error, no truncation |
| Coverage ledger/count strings and watermark ledger strings | retain `string`; validate any conversion per field | `String`; do not assume every count or `nextLedger` fits `u32` | `string`; field-specific checked conversion |
| Account REST `flags` / GraphQL `flags` | integer / string; normalize only after validation | checked integer / `String` wire model | checked integer / `string` wire model |
| Account `balance`, liabilities | `number`, labelled Float64 observation; `balanceRaw` stays `null` | `f64` plus precision marker; no reconstructed atomic amount | `float64` plus precision marker; no reconstructed atomic amount |
| Holder `balance` and liabilities (`HubbleParsedNumber`) | `number | string`; preserve received form | untagged numeric/string enum | tagged decode via `json.RawMessage`; retain string or float |
| Typed transaction `amounts` | retain `raw`, `decimal`, `scale`, `source` together | strings and explicit scale; checked conversion on demand | strings and explicit scale; checked conversion on demand |
| Nullable fields and terminal `nextCursor` | explicit `null`; distinguish omitted optional fields | `Option<T>` with raw response retained | pointers or explicit nullable wrapper with raw response retained |
| Unknown response fields | retain in raw access; no unknown request fields promised | extra-field map for raw access | raw JSON retained alongside typed fields |
| GraphQL error metadata | message plus optional path, locations and extensions; code can be absent | optional diagnostic fields and raw extensions | optional diagnostic fields and raw extensions |

A decimal-looking holder string still carries `float64-observation`; its text
does not establish exact atomic units. The exact transaction amount
`9007199254740993` and large identifiers survive as strings. Supplemental
`detailsJson` can contain rounded numbers and must not override typed exact
amounts. Event `topicsJson`/`dataJson` remain strings for a future lossless decoder.

## Conformance matrix

| Case | Existing contract outcome | Proposed client expectation |
| --- | --- | --- |
| Account first → terminal | Opaque account-scoped `nextCursor` → `after`, then `null` | Same account and limit; stop at null; retain coverage and watermark |
| Holder first → terminal | Full asset identity and unchanged sort/order; composite cursor for balance ordering | Keep asset, filters, order and limit; never use asset-discovery `cursor` as holder `after` |
| Transaction first → continued → terminal | Separate `operationsAfter`, `effectsAfter`, `eventsAfter`; all map to separately named REST parameters | Advance only the intended relation; do not derive a cursor from an ID or row count |
| Invalid limit `201` | REST 400 `invalid_hubble_query`; GraphQL resolver error `BAD_USER_INPUT` in the HTTP 200 contract | Inspect GraphQL `errors` even when HTTP status is200; never return an empty successful page |
| Wrong account, changed holder sort or wrong transaction relation | Existing cursor validators reject scope changes; REST 400 and GraphQL `BAD_USER_INPUT` | Start over when selection changes; keep each relation's cursor separate |
| Noncanonical account cursor `abc+/=` | URL decoding preserves the characters; the actual account cursor validator rejects them | URL encoding does not make an arbitrary token valid; treat returned tokens as opaque |
| REST holder UInt32 maximum | REST accepts `as_of_ledger=4294967295` when within synthetic catalog coverage | Keep full UInt32 range for this REST input |
| Same value in GraphQL input | GraphQL `Int` variable coercion rejects it | Reject locally for GraphQL; do not truncate or promise transport parity |
| Account observation above signed32 | REST retains UInt32 value; GraphQL non-null `Int` serialization produces errors | Preserve the failure and raw diagnostic context |
| Coverage gap and unpinned watermark | Completed ranges `[2,65]` and `[130,193]`, one gap, `snapshotPinned:false` | Maximum ledger and an empty result do not establish complete history or current-chain absence |
| Empty account observations | REST 200 and GraphQL empty balances with terminal cursor | Preserve valid emptiness and coverage; do not manufacture an account404 |
| Typed transaction absent from ingested data | REST 404 `hubble_not_found`; nullable GraphQL result without errors | Preserve absence within ingested coverage, not proof of never existing on chain |
| Warehouse unavailable | REST 503 and GraphQL `SERVICE_UNAVAILABLE` in the HTTP 200 contract | Return an error; preserve a previous successful page separately |
| Unsupported account as-of selection or duplicate REST query keys | REST 400; unknown GraphQL input fields fail variable coercion | Only expose fields supported by the chosen workflow; do not silently discard unsupported selections |
| Unknown GraphQL response field | Registered schema validation rejects the selection before warehouse work | Check schema compatibility before sending a query |
| GraphQL request work budget | Four balance roots cost 32 and execute; five cost 40 and produce `QUERY_TOO_COMPLEX` before warehouse work | Split the query; do not retry it unchanged. Status depends on the negotiated response type below |

## Measured HTTP negotiation

These POST cases use the pinned `graphql-http` 1.22.4 adapter, GraphQL 16.11.0 and
Express 4.22.2 with injected synthetic services. The first 17 fixture checks also
rerun through the real adapter. Full request/response evidence is retained in
[the negotiation fixture](fixtures/http-negotiation.json); the four selected
REST mount checks are in [the mount fixture](fixtures/rest-mount.json).

| Tested outcome | Accept `application/json` | Accept `application/graphql-response+json` |
| --- | --- | --- |
| Successful query | 200 with data | 200 with data |
| GraphQL syntax error | 200 with errors | 400 with errors |
| Unknown schema field | 200 with errors | 400 with errors |
| Invalid variable type | 200 with errors | 200 with errors |
| Resolver input rejection | 200 with `BAD_USER_INPUT` | 200 with `BAD_USER_INPUT` |
| Request-budget rejection | 200 with `QUERY_TOO_COMPLEX` | 400 with `QUERY_TOO_COMPLEX` |
| Warehouse unavailable | 200 with `SERVICE_UNAVAILABLE` | 200 with `SERVICE_UNAVAILABLE` |

Responses use the negotiated JSON media type. `Accept: text/plain` returns 406 in
the tested case. Always inspect GraphQL `errors`, including at HTTP 200, and keep
HTTP failures distinct from successful empty pages. Diagnostic extensions are
optional; syntax, schema and coercion errors need not carry a service error code.
These measured cases do not promise an HTTP status for every possible failure.

Native and issued balances are latest-ingested observations. Holder selection at
a ledger is an upper bound over available observations, not a frozen snapshot.
Incoming ingestion can change pages. The packet makes no current-state guarantee,
retry policy implementation, automatic iteration or unsupported subscription
promise. Cancellation, repeated-cursor loop protection and all three client
implementations remain future conformance work.
