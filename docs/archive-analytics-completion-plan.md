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

## Resumed implementation — 2026-09-06 UTC

- Deployed and pushed d6444de0: one source-failure continuation predicate handles
  first terminal remote failures and reused buckets referenced by later
  checkpoints. Same-network verified replacement evidence permits continuation;
  the failed source proof and object remain failed, with explicit substitution
  provenance. No mass retry or backlog rewrite was performed.
- Exact live acceptance: GALOU advanced 139 additional checkpoints and MoneyGram
  v3 advanced 54 after initial admission. Their original errors/attempt counts
  remained unchanged. A periodic root-refresh admission issue was then isolated
  separately; it is not evidence that the original source failure was cleared.
- Shared dependency writes now skip root-scoped duplication only after validating
  that source's complete shared artifact. Existing legacy fallback remains for
  incomplete/malformed historical artifacts; no historical evidence was deleted.
  This is not yet the shared canonical evaluation-artifact acceptance gate in B.
- Public summary scope now matches its case-sensitive source inventory. The four
  invalid lowercase BDTrust aliases remain available to forensic reads but no
  longer inflate public coverage. At 03:52 UTC: 82 sources, 8,413,602 durable
  root-checkpoint attestations; canonical cursor reports 1,004,609 checkpoint
  positions through ledger 64,294,975. These are distinct measurements and do
  not imply that all source archives are complete or that F is implemented.
- Deployed and pushed 5cffdcf6: typed transaction REST/GraphQL returns parsed
  transaction, operations, effects and classified events with independent keyset
  cursors. Exact operation amounts are derived from retained hash-checked XDR,
  not rounded ETL floats. Legacy responses remain compatible.
- Live browser acceptance: Swagger returned HTTP 200 for the documented typed
  transaction request. GraphQL returned real results and independent operations
  and effects pages (722/658 ms subsequent pages); phone-width layout verified.
  Initial cold lookup took 8.5 seconds. Hash-only query projection/budget work
  remains open; the ledger hint is optional, not fabricated completeness.
- API IPC disconnect races now use callback-based handling. Eighteen supervisor
  tests and the actual backend build passed. The API primary was restarted once
  to load the fix; all four workers became ready. The scanner retained its PID
  and zero restarts throughout.
- The modern Hubble trial exposed lossy heterogeneous JSON inference. The fix
  uses the pinned official ClickHouse Native encoder over the existing HTTP
  client, with explicit nested Dynamic values and versioned deduplication tokens.
  Exact scalar/container/XDR round-trip tests and Go race tests passed.
- Only six partition-60 sets proven to contain exclusively the failed priority
  batch were recoverably detached (1,032,343,150 bytes). Original LCM, all other
  batches and historical partitions were preserved. Detached rows must not be
  reattached alongside repaired public data. The corrected importer is running
  with the existing two workers and I/O pressure guard. The modern batch completed
  at 04:01:55 UTC: 1,024 ledgers, original source digest, no error. Its 4,078,156
  event rows and 183,519 contract-data changes are now published. The one-time
  priority was removed without restarting; ordinary ascending work continues.
  Public Swagger returned the real successful InvokeHostFunction at ledger
  63,490,364, decoded plant parameters, original event XDR and correct fee versus
  Soroban diagnostic execution classifications. This is supplemental coverage.
- Remaining product gates are still explicit: full raw/parsed gap closure,
  complete semantic API/state-view parity, shared canonical evaluation artifacts,
  partial-state witness/BLS publication, and sustained performance acceptance.
  A successful vertical slice is not completion of the whole system.

## Final acceptance checks — 2026-09-06 UTC

- Snapshot admission is deployed: a pending/failed root refresh no longer blocks
  historical work within that same source's last validated advertised head.
  Exact-key live checks at 04:26:56 UTC: GALOU next checkpoint 637,567 and
  MoneyGram v3 3,538,495, both advancing automatically. Original failures remain.
- Public browser verification on the Lightsail C source page showed 154,624
  unresolved remote checks, exact HTTP 404 and checkpoint/path attribution,
  verified alternate-source links, Retry once, and proof-bound repair manifests
  with the expected logical digest. No retry or operator archive write was made.
  Counts visibly advanced without reloading; the header timezone inconsistency
  was isolated for correction.
- The optional ledger-hinted typed transaction and GraphQL examples returned a
  genuine successful Soroban invocation at ledger 63,490,364. The GraphQL docs
  example completed in 775 ms and exposed a next-events cursor. A public contract
  state-change query returned decoded key/value state plus original XDR in
  167 ms. These are actual published supplemental data, not full-range coverage.
- Commit 49c8f871 removes toString() around native String equality/IN predicates,
  allowing existing transaction-hash indexes to participate. Missing historical
  index coverage still prevents claiming fast unhinted full-history lookups.
- One existing hash index was materialized only in transaction partition 2
  (4,351 rows). The same lookup pruned 3 to 1 granule and read 4 rows / 328 bytes
  in 45 ms. Original/new compact data-file SHA-256 values match exactly, but
  2,842,496 bytes were physically copied (not hardlinked). Do not extrapolate
  this into a free full-history index build. At 04:28:25 UTC the mutation remained
  open because its remaining bookkeeping parts belonged to a pre-existing
  partition-25 merge; target index work was complete and no error was reported.
  No additional partition or global index materialization was launched.

- Final batch fix 822735d3 is deployed: stale lease/generation claims are counted
  as superseded, never completed or failed, and cannot roll back active siblings.
  Only SQL-locked/handled identities reach acknowledgement and next planning.
  Six focused suites / 35 tests pass, including eight real PostgreSQL regressions;
  the complete backend build, alias rewrite and post-build steps passed.
- Four API workers were replaced one at a time with HTTP-200 readiness checks;
  primary PID 390289 was preserved. The dispatcher restarted on the built code.
  Scanner PID 3256571 and Hubble PID 1751618 remained active with zero restarts.
  No matching batch-count, connection-pool, IPC or deadlock errors appeared in
  the checked post-rollout API logs through 04:45 UTC; dispatcher checks also
  found no recurrence of the batch-count error. This is a bounded live check.
- Frontend local-time fix 49344191 passed 22 focused tests and a production build.
  Staging archive/docs routes returned HTTP 200 before promotion. One promotion
  invocation omitted appDirectory and was rejected without changing aliases;
  the unchanged frontend was immediately restarted and checked. The corrected
  invocation promoted slot A successfully with slot B retained for rollback.
  Live browser screenshot then confirmed the header uses 12:45 AM EDT rather
  than 4:45 AM UTC; exact errors, alternate sources and Retry once remain shown.
- At 04:45:11 UTC: 8,498,704 durable root-checkpoint attestations across 82 sources;
  canonical tracker 1,004,618 / 1,004,620 positions (two newly advertised positions
  pending). Source attestations increased 8,677 over the previous 305.196 seconds,
  approximately 1,706/minute. This is not a unique canonical-checkpoint rate or
  proof that full cross-root catch-up is complete.
- Parsed warehouse coverage at 04:45 UTC: continuous ledgers 2-27,319,426 plus
  1,024 supplemental modern ledgers, across 20 datasets. Full history ingestion,
  the complete shared evaluation cutover and BLS/state witness gates remain open.
