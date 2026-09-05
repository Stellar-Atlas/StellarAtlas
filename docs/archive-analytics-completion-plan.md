# Archive and analytics completion plan

Status: audit reconciled 2026-09-05; implementation in progress, not product completion.
This plan extends the active issue tracker. Tests and production evidence, not
the presence of code, decide whether each acceptance gate is complete.

## Architecture and existing work to preserve

- Retain one lossless LedgerCloseMeta lake and content-addressed archive objects.
- Keep parsed Hubble-equivalent history in ClickHouse. PostgreSQL owns application
  state, identities, durable source evidence and verification coordination.
- A parsed content artifact is shared by digest, representation and derivation
  version. A different archive must still serve and hash its own bytes.
- Existing verified checkpoint evidence seeds the canonical artifact set. Do not
  discard it or rerun valid parsing because its original owner was another root.
- Root-specific missing/corrupt files remain failures even when a canonical
  replacement permits continued scanning.
- REST, typed GraphQL, explorer and Horizon-compatible historical reads must call
  the same semantic query services, not independently maintained full histories.
- Official Horizon and RPC cannot simply be pointed at ClickHouse. Preserve their
  working specialized stores until adapters have demonstrated compatibility;
  do not create another full analytical copy for either service.

## Audited gaps

1. Parsed content reuse works, but checkpoint evaluation/identity is still
   root-scoped. A shared canonical proof artifact is not implemented merely
   because the preferred root's cursor reports 100%.
2. Current v10 counts, ever-attested checkpoint counts and cursor-derived chain
   progress are distinct. Global and normalized-source totals use different scopes.
3. Claiming/retrying an object or recording a worker failure can hide an earlier
   remote failure before a successful same-source replacement.
4. Ledger/header/transaction/result/bucket commitments are checked. Archive SCP
   is decoded and optional in the current checkpoint policy, not an implemented
   consensus-signature/quorum authentication gate.
5. No owned partial-state witness generator or BLS12-381 publisher/verifier was
   located. These remain explicit implementation work, not rejected product goals.
6. Lake ingestion and ClickHouse ingestion both advance but are incomplete.
   Warehouse min/max metadata does not by itself establish contiguous coverage.
7. Generic GraphQL and legacy explorer reads are not semantic ClickHouse parity.
   Existing real Swagger/GraphQL request runners do not solve that missing API.
8. Contract-event naming includes classic events. Neither a contract ID nor the
   success flag proves Soroban execution. Current-state views need complete
   baseline plus ordered changes, not a raw change list.
9. Stored trade amounts are Float64; token transfers preserve exact amount_raw.
   Casting existing trade floats cannot recover lost original precision.

## Dependency-ordered work packages

### A. Keep verification live and source findings durable

Owner: archive evidence agent, integrated by main.
- Preserve a remote finding through claim, timeout, retry and local worker error.
- Resolve it only after successful verification of the same source/object.
- Use sparse evidence and existing terminal writes; no per-stage database events.
- Update rollups and public failure queries together; preserve historical evidence.
- Reconcile URL-normalized inventory scope and expose current/durable/cursor
  semantics explicitly without inventing coverage.

Acceptance: 404 -> claim -> local error stays unresolved; canonical fallback does
not clear it; same-source success clears it; stale attempts cannot clear newer
failures; failed-file details and repair remain correctly attributed.

### B. Shared canonical checkpoint artifact and source attestations

Depends on audited identity/manifest contract; can develop alongside A.
- Define immutable network/version/checkpoint/input-digest/predecessor manifests.
- Select existing eligible verified evidence as seeds, preserving provenance.
- Match another root's complete input manifest to reuse the canonical proof.
- Persist only that source's byte evidence/attestation, not another full
  cross-file evaluation when the authenticated inputs are identical.
- Keep mismatch and missing-source evidence outside canonical validity.
- Shadow-compare bounded existing samples before changing admission/evaluation.
  No wholesale rewrite/delete/backfill of legacy evidence.

Acceptance: multiple source seeds, exact match skips evaluator, wrong network/
version/input/predecessor cannot reuse, source error stays visible, scanner
continues beyond unavailable files. Compare measured writes and progress before
cutover; retain rollback until parity passes.

### C. Coverage, event provenance and full parsed ingestion

Owner: ingestion agent, integrated by main.
- Derive contiguous and supplemental ranges from the small ingestion manifest.
- Classify bounded event pages using originating transactions/operations;
  separate transaction kind, event kind and diagnostic provenance.
- Preserve unknown provenance rather than guessing from dates or contract IDs.
- Feed one known retained modern batch through the existing importer using
  explicit priority selection, not a competing importer or repeated downloads.
- Continue autonomous gap fill and publish each dataset's proven coverage.
- Add lossless raw trade amounts at transformation time with a versioned,
  targeted migration plan for existing rows; do not cast floats as exact data.

Acceptance: gap/overlap/retry metadata fixtures; classic fee, fee inside Soroban
transaction, InvokeHostFunction and missing-link cases; real modern invocation,
events and state visible together; supplemental import cannot advance the
contiguous historical watermark across a gap.

### D. Shared semantic APIs and usable developer/explorer surfaces

Owner: API agent plus main frontend integration.
First vertical slice: exact transfers by account/asset/from/to, transaction,
ledger range, UTC time and integer amount, with typed REST/GraphQL parity.
- Additive routes preserve existing clients.
- One shared validator/query/DTO; completed-batch+digest visibility retained.
- Keyset pagination includes all tie-breakers and returned ledger bounds.
- Bounds are explicit. Reuse the server-managed read-only query profile; do not
  override it from per-route SQL. The audited profile allows 30 seconds, 32 GiB
  query memory and 10,000 result rows; it lacks read-row/read-byte caps.
  Profile hardening and query-oriented projections remain an open resource gate.
  First acceptance probes use narrow ledger ranges, not large production scans.
- Amounts and large identifiers remain strings; contract token decimal scale is
  unknown unless actually established.
- Interactive docs and explorer run real requests and expose pagination,
  coverage, failures and returned amounts.

Acceptance: transport parity, exact amounts >2^53, wrong cursor/filter rejection,
stable ordering, date/amount validation, no failed-batch leakage, actual multi-page
production request, mobile/desktop browser QA, existing routes unchanged.

Then extend the same services to transaction/operation/effect relationships,
trades/offers/pools/assets, contract invocations/events/state and bounded
relationship traversal/subgraphs. This first slice is not complete Hubble parity.

### E. State views and Horizon-compatible read unification

Depends on C coverage and D query contracts.
- Reconstruct a complete checkpoint baseline from verified buckets once.
- Apply ordered state changes with deletion/shadowing/archival semantics.
- Build query-oriented account/asset/offer/contract projections in ClickHouse
  with explicit height/watermark and reproducible derivation.
- Implement Horizon-compatible representations, paging tokens and relationships
  over shared services; test against the supported Horizon contract.
- Move historical reads only after parity, keep transaction submission and RPC
  simulation/current-state duties on their appropriate services.

Acceptance: balances/holders at height, ever-held history, deletes and restores,
all pages without omission/duplication, exact amounts and protocol behavior.
Switching an API route is not sufficient evidence to retire Horizon storage.

### F. Authenticated checkpoint and partial-state proof publication

Depends on B and a reviewed proof statement/trust policy; state witnesses depend
on E reconstruction. Existing integrity evidence remains useful throughout.
- Bind network, checkpoint height/hash, predecessor, state commitment, derivation
  version and configured trusted anchor/consensus policy into the artifact.
- Implement required SCP signature/quorum/ledger binding checks where the chosen
  authentication policy requires them; never call XDR decoding that check.
- Generate membership, nonmembership and multiproofs for requested ledger keys.
  Prove the derived representation's binding to the checkpoint; a new Merkle
  root alone is not that binding.
- Specify whether BLS12-381 artifacts are signed watchtower attestations or
  computational validity proofs, then implement generation, verifier, key
  lifecycle, domain separation and immutable publication.
- Double-spend protection must bind ownership/state evolution, freshness and
  spent/nullifier/non-equivocation rules, not only prove past membership.

Acceptance: wrong network/height/key/value, deleted/shadowed/archived entries,
forged consensus data, fabricated internally consistent fork, replayed artifact,
key rotation and attempted duplicate redemption. No public security guarantee
is marked complete until its corresponding adversarial test passes.

## Deployment and reconciliation

- Three scoped agents maximum; main owns integration, plan and public QA.
- No services are stopped for audits. No broad scans or database rewrites.
- Run focused tests, then actual repository builds including alias rewrites.
- Review schema/rollup effects before live migration; bounded lock timeouts.
- Stage frontend in inactive slot; smoke test before promotion.
- Reload API workers in a rolling sequence; only restart a changed dispatcher
  after its artifact is built. Preserve scanner and ingestion operation.
- Commit reviewed changes to main and record exact deployed revision.
- Measure actual API results and advancing source coverage; distinguish completed
  code, deployed features, ingestion progress and still-open acceptance gates.

## Verified release — 2026-09-05

- Sparse retained-source migration applied individually, initially disabled.
  Four API completion workers drained/replaced one at a time; trigger enabled
  only afterward. No archive scanner restart, queue rewrite or historical deletion.
- Backend and frontend production builds passed. Focused gates: 67 Hubble tests,
  64 archive-retention/API/UI tests, 13 transfer/docs/explorer UI tests, plus Go race tests.
- Public REST and typed GraphQL returned real transfer pages with exact amounts;
  next/previous pagination and account route filtering were exercised.
- Same 100-ledger transfer fixture improved from 25 million rows / 2.03 GB read
  to about 42,300 rows / 5.9 MB through native primary-key predicates.
- Frontend inactive slot was smoke-tested on archives/docs/explorer/status,
  then promoted. Phone-width transfer results have no horizontal page overflow.
- Catalog now returns merged, continuous completed-batch coverage separately
  from supplemental ranges. Live sample: ledgers 2 through 26,543,234 continuous.
- Classification distinguishes classic/native fee events from invocation evidence;
  genuine Soroban fixture tested. This does not claim modern warehouse coverage.
- Optional exact batch priority selector is tested but NOT enabled in production.
  Candidate 3dca0dce-5e01-4620-a95b-e95ce4a58323 remains an explicit follow-up.
- Shared immutable canonical checkpoint manifests, full analytics catch-up,
  state views/Horizon unification, and witness/BLS publication remain open.
