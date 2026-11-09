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

## Opt-in compact ledger-entry changes

The default converter still emits manifest v8 and ledger-entry-changes v3.
For a separately approved new range, `--compact-ledger-entry-changes` emits
manifest v9 and ledger-entry-changes v4 instead. The v4 Parquet omits only
`pre_entry_xdr` and `post_entry_xdr`; it retains exact key XDR/hash, change
context and ordinals, and both presence flags. All other artifacts, including
the paired lossless LCM, are unchanged. Recovery refuses an existing artifact
written in the other mode; it never replaces immutable v3 files.

To reconstruct the bodies offline, use the same batch's `ledger-close-meta`
descriptor to verify the canonical artifact digest. Decode it with
`pkg/lcmbatch` and use the pinned converter's ledger-entry-change transform.
Match ledger sequence, transaction and change ordinals, reason and scope,
and verify key and presence flags before using the reconstructed pre/post XDR.
No online transaction or account lookup uses this replay path.

Do not select v4 until download readers recognize the schema and the explicit
catalog migration has been separately reviewed. The service launcher does not
pass the opt-in flag by default, and the migration candidate is not registered
for automatic execution.
