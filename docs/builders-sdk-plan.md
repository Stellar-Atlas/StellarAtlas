# Builders SDK design and implementation plan

Status: **proposed design, November 1, 2026**. This document does not announce
an implemented or released SDK. The interfaces below are design sketches, not
installable packages or executable examples.

The
[Q4 proposal's SDK commitment](https://github.com/SCF-Public-Goods-Maintenance/scf-public-goods-maintenance.github.io/blob/e136962d7549f82a2cd8c66fd83a2d4238c05487/docs/projects/stellaratlas.md#builders-sdk-plan)
is a design, examples and development plan, with **TypeScript, Rust and Go** as
proposed first targets. A released SDK is a longer-term H1 2027 target, not a Q4
release promise. The milestones below define proposed implementation gates, not
completed work or new award commitments.

## Initial workflows and contract mapping

Build a small typed layer over existing read APIs. Generate transport models
from a pinned public OpenAPI document and GraphQL schema; add handwritten
workflow helpers only where they remove repeated pagination and error handling.
Keep the raw response, coverage and freshness metadata accessible.

| Proposed SDK method                  | Existing REST contract                                                                           | Existing GraphQL field                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Account balances                     | `GET /v1/analytics/accounts/{account}/balances` with `after`, `limit`                            | `hubbleAccountBalances(account, input)` / `HubbleAccountBalanceInput`                                   |
| Asset holders                        | `GET /v1/assets/{asset}/holders` with `after`, `limit`, `sort`, `order`, optional `as_of_ledger` | `hubbleAssetHolders(asset, input)` / `HubbleAssetHolderInput` (`asOfLedger` in GraphQL)                 |
| Transaction detail and related pages | `GET /v1/analytics/transactions/{transactionHash}?view=typed`                                    | `hubbleTransaction(transactionHash, ledgerSequence, limit, operationsAfter, effectsAfter, eventsAfter)` |

Transaction REST inputs include `ledger_sequence`, `limit`, `operations_after`,
`effects_after`, and `events_after`; keep each relationship's cursor separate.
Use the existing [GraphQL runner](https://stellaratlas.io/docs/graphql) account
balances, KALE holders and transaction presets as request fixtures. Preserve the
same account or full `CODE:ISSUER` asset identity across transports. Asset
discovery uses `/v1/assets` and `cursor`; it must not reuse a holders `after`
token.

## Proposed language API sketches

These names are proposed application interfaces. No import paths, package names,
registry versions or installation commands have been assigned.

```typescript
// Proposed TypeScript surface, not a released client.
interface AtlasReadClient {
	accountBalances(
		account: string,
		input: BalanceInput
	): Promise<AccountBalancePage>;
	assetHolders(asset: string, input: HolderInput): Promise<HolderPage>;
	transaction(
		transactionHash: string,
		input: TransactionInput
	): Promise<TransactionDetail>;
}
```

```rust
// Proposed Rust methods, not an existing crate.
async fn account_balances(&self, account: &str, input: BalanceInput) -> Result<AccountBalancePage, AtlasError>;
async fn asset_holders(&self, asset: &str, input: HolderInput) -> Result<HolderPage, AtlasError>;
async fn transaction(&self, hash: &str, input: TransactionInput) -> Result<TransactionDetail, AtlasError>;
```

```go
// Proposed Go methods, not an existing module.
func (c *Client) AccountBalances(ctx context.Context, account string, input BalanceInput) (AccountBalancePage, error)
func (c *Client) AssetHolders(ctx context.Context, asset string, input HolderInput) (HolderPage, error)
func (c *Client) Transaction(ctx context.Context, hash string, input TransactionInput) (TransactionDetail, error)
```

`BalanceInput` corresponds to the existing `after` and `limit` inputs.
`HolderInput` adds the documented holder selection, sorting and order fields.
`TransactionInput` preserves ledger hints and separately named relationship
cursors. Inputs and result names above are proposed SDK types; their wire fields
must match the pinned schemas rather than inventing new API parameters.

Provide one-page calls first. Later iterators may accept an explicit maximum
page count and cancellation; they must not silently download all history.

## Pagination, coverage and precision policy

- Keep cursors opaque and scoped to route, account/asset, filters, order and
  page size. Pass `nextCursor` unchanged as the documented input, and stop at
  null. Detect a repeated cursor rather than looping. Changing filters starts
  over.
- Preserve `coverage` and `watermark` on every page. Latest-ingested balances
  and holders are observations, not guaranteed current-chain state. A selected
  ledger is an upper bound, not a frozen database snapshot. Do not infer
  complete per-dataset history from the highest imported ledger or an empty
  result.
- Keep exact IDs, hashes and raw amounts as strings on the wire. TypeScript must
  not coerce them through `Number`; Rust and Go must use explicit exact integer
  or decimal conversion on request. Validate bounded ledger numbers separately.
- Preserve `amountRaw`, explicit scales and precision labels when returned; do
  not assume every asset has seven decimals. Source Float64 balances,
  approximate aggregates and legacy observations must retain their approximation
  status. Converting an approximate value to a decimal string cannot recover
  precision.
- Keep decoded event payload strings available. A lossless parser is required
  before interpreting large numeric literals in `topicsJson`/`dataJson`; handle
  the documented literal `void` sentinel without treating it as JSON.

## Errors, compatibility and freshness

Return typed errors containing transport status, GraphQL errors, route and safe
diagnostic metadata. A GraphQL HTTP 200 with `errors` is not unconditional
success. Do not replace an unavailable service with an empty successful page.
Apply the documented 404/409 absence distinction only to routes that actually
specify it.

Retries are proposed only for explicitly idempotent reads and transient
failures: honor `Retry-After` when present, cap attempts and delay, add jitter,
and support abort/context cancellation. Do not retry invalid input, unsupported
parameters, or schema mismatches indefinitely. Preserve the last successful page
separately from a failed continuation.

Pin generated code to a schema digest and expose the SDK's contract version.
Compare schema changes before regenerating: field removal, changed types and
enum changes need compatibility review. Retain unknown response fields in raw
access where practical; reject unknown request fields locally. Do not invent a
server version header or treat a successful parse as proof of schema
compatibility.

The current `/v1/stream/data` WebSocket is an origin-restricted first-party feed
of `datasets.published` hints. It is not a replayable event/payload log or a
`graphql-ws` subscription endpoint, and it accepts no wallet/asset
subscriptions. An initial third-party SDK therefore promises **no general
WebSocket subscription method**. Use bounded read refreshes with backoff.
First-party integrations may coalesce notices, bound batch-ID deduplication,
reconnect with capped backoff and recheck coverage after disconnects. See
[WebSocket guidance](https://stellaratlas.io/docs/live-updates).

## Proposed implementation milestones and conformance gates

| Gate                           | Planned work                                                                                          | Required evidence before advancing                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Contract/design review      | Pin OpenAPI/GraphQL schemas, select the three workflows, review language mappings and public examples | Reviewed request/response fixtures with exact names, coverage, precision and error semantics; no package availability claim                |
| 2. TypeScript reference client | Generate the selected models; implement bounded one-page calls, cancellation and scoped pagination    | Conformance fixtures pass; maintained examples compile; exact identifiers and raw amounts survive a round trip                             |
| 3. Rust and Go parity          | Implement the same reviewed workflows and language-specific cancellation/error handling               | The same normalized fixture outcomes across all three clients; documented wire mappings and unknown-field behavior                         |
| 4. Release readiness           | Package review, compatibility policy, docs, changelog and a bounded live acceptance run               | Approved versions/artifact identities and passing CI; independently reviewed publication decision before any registry/release announcement |

The [SDK workflow contract fixtures](sdk-contracts/README.md) pin a bounded
synthetic account, asset and transaction design packet against a specific source
revision, with offline server-contract checks and proposed language mappings.
Independent review of that packet supports gate 1; it does not implement or
release any of the proposed clients.

Initial conformance cases for future client implementations:

1. First/second/terminal pages for balances and holders; pass returned cursors
   unchanged through URL encoding with unchanged filters. Noncanonical tokens
   containing `+`, `/` or `=` are rejection cases where the existing cursor
   validator disallows them. Add client repeated-cursor and cancellation handling.
2. KALE identity remains `CODE:ISSUER`; duplicate symbols never select an issuer
   implicitly. Discovery, holder and transaction-relation cursors cannot cross.
3. IDs and raw amounts above `2^53` and large event integer literals remain
   exact; Float64 observations stay labelled approximate; `void` decoding
   remains valid.
4. HTTP 400/404/409/503 and GraphQL HTTP-200 errors retain their distinct
   meaning; bounded retries never turn a failed continuation into apparent
   absence.
5. Coverage gaps, stale watermarks and changing ingestion remain visible across
   pages; unsupported subscriptions and breaking schema changes fail explicitly.

Use local recorded/synthetic fixtures in ordinary CI. Keep any live acceptance
bounded to reviewed known-result examples; do not scan history or depend on a
mutable holder count as a permanent expected value. These are planned cases, not
a statement that a new SDK or client conformance suite exists today. The linked
design packet tests existing server contracts separately.

## Future multihop swap pathfinding: data and validation requirements

Pathfinding is future design work, not a feature of this SDK plan's initial
client. Historical offer changes and observed pool records cannot establish an
executable route or live liquidity.

For native Stellar markets, require fresh offers/order books and pool reserves
at identified ledger positions, canonical asset identities, issuer/trustline
constraints, fees, integer/decimal precision, rounding, slippage and capacity
limits. Evaluate how Atlas observations can complement existing Horizon path
discovery rather than claiming to replace a current quote/execution service.

Soroban exchanges require their own contract and token identities, quote
methods, pool/router semantics, execution/auth constraints, fees and resource
costs. Native Stellar order-book paths must not be applied to Soroban venues by
assumption.

Validation gates: reject stale, partial or mixed-ledger inputs; compare
candidate quotes with the venue's supported quote/simulation path; check
conservation, rounding, fee application, capacity and min-received/max-sent
bounds; exercise reversed pairs, illiquid hops and failed simulation. A proposal
must document where no current state/quote is available and return an
unavailable result rather than manufacture a path. No route, subscription or
completion date for this future capability is introduced here.
