# StellarAtlas full-history ETL

This module validates SEP-54 `LedgerCloseMeta` batches and transforms them into
bounded range artifacts. It does not retain downloaded provider objects.

For each committed range it publishes:

- one `lossless-replay` Zstandard/XDR artifact containing every validated
  `LedgerCloseMeta` record in ledger order;
- typed Parquet projections for current lookup and analysis fields; and
- a manifest with source identities, byte hashes, ledger-chain boundary hashes,
  output hashes, media types, schemas, and representation labels.

Provider objects exist only in private shared memory while a range is being
processed. The lossless replay artifact is a normalized reconstruction source,
not a byte-for-byte copy of the provider's object layout. It permits future
projections to be rebuilt without repeatedly downloading the same history.

`typed-projection` means the file contains only the fields declared by its
versioned schema. It must not be treated as a complete explorer dataset. The
manifest's `unsupportedDatasets` list records material fields and read models
that still require transforms.

Durable batches are immutable. Adjacent batches must link by ledger hash before
the Postgres watermark can advance. Publication is atomic, source inputs are
removed on success or failure, and a periodic bounded cleanup removes abandoned
owned staging directories after crashes.
