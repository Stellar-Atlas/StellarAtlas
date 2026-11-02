# Explorer and developer documentation

- Preserve asset-tab selection in shareable URLs and browser navigation.
- Improve exact integer presentation in contract state changes and distinguish unknown outcomes.
- Connect contract-event examples, continuation guidance and publication-update documentation.
- Retain pending frontend event context, network-stream and archive/status presentation improvements.

## Unreleased source changes

The following frontend and documentation changes are included in
[merged source f14988c4](https://github.com/Stellar-Atlas/StellarAtlas/commit/f14988c49e23fbb4e02bde72bc11709c5f866b5a).
Release versions and deployment status are tracked separately.

### Explorer navigation and developer workflows

[PR #39](https://github.com/Stellar-Atlas/StellarAtlas/pull/39)

- Preserve asset tabs, holder sorting, page position and historical market windows
  in shareable URLs and browser navigation. Keep pagination tied to the displayed
  asset or pool query.
- Show compact contract-state previews with expandable decoded details, preserve
  large integer values, and distinguish unknown outcomes from reported results.
- Add asset and wallet quickstarts, REST and GraphQL continuation examples, error
  handling guidance and bounded refresh examples for publication notifications.
  The builders SDK plan describes proposed interfaces and implementation stages.

### Query boundaries and data context

[PR #42](https://github.com/Stellar-Atlas/StellarAtlas/pull/42)

- Validate typed explorer searches and preserve filters and page context through
  browser navigation. Keep ledger transaction requests scoped to the selected
  ledger and retain the displayed pool page when a replacement request fails.
- Link decoded record references to related entities while retaining relevant
  historical context.
- Explain quickstart response fields, coverage and pagination, and document
  catalog and batch discovery for immutable history downloads. Verify a complete
  downloaded artifact against its published SHA-256 digest; published batches do
  not establish complete chain history.
- Add the contract build verification guide, including provenance lookup,
  supported publication metadata and status interpretation. Verification checks
  signed build provenance; it does not independently rebuild the source.

### Record readability and copyable examples

[PR #43](https://github.com/Stellar-Atlas/StellarAtlas/pull/43)

- Present nested record fields as bounded expandable details, with raw details
  available for deeper inspection.
- Display transaction fees in exact XLM with raw stroop values available. Keep
  balance provenance and coverage details accessible: balances remain
  latest-ingested Float64 observations, not current-chain or historical as-of
  snapshots, and pages can change as ingestion progresses.
- Improve the explorer hierarchy on small screens and keep long navigation lists
  scrollable.
- Keep documentation field names inline and add keyboard-accessible copy controls
  for complete guide examples. Show success after a clipboard write succeeds and
  offer manual-copy guidance when copying is unavailable or fails.
