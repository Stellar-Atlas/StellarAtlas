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

## Offline transaction reconstruction

`cmd/full-history-reconstruct` rebuilds only `transactions`,
`transaction-results` and `operations` from one existing local replay file. It
uses the same decoder, transaction binding and Parquet writers, but does not
build unrelated event/state projections or another canonical replay copy.
Normal ingestion and its output contract are unchanged.

Build it with `go build -o full-history-reconstruct ./cmd/full-history-reconstruct`.
The caller must control the input and scratch parents and keep them immutable
for the run; this local tool is not an untrusted-path or concurrent-writer API.
Supply the expected compressed source digest and an explicitly bounded scratch
location; the output must be a new leaf beneath that root:

```sh
./full-history-reconstruct \
  --input "$CANONICAL_FILE" --input-object-key replay/canonical.xdr.zst \
  --expected-source-sha256 "$CANONICAL_SHA256" \
  --typed-output-root "$SCRATCH_ROOT" --output "$SCRATCH_ROOT/reconstructed" \
  --network pubnet --network-passphrase 'Public Global Stellar Network ; September 2015' \
  --start-ledger "$START_LEDGER" --end-ledger "$END_LEDGER" \
  --max-compressed-bytes "$INPUT_BYTE_LIMIT" --max-uncompressed-bytes "$XDR_BYTE_LIMIT" \
  --max-decoded-memory-bytes "$DECODE_BYTE_LIMIT" --max-output-bytes "$OUTPUT_BYTE_LIMIT" \
  --max-ledgers "$LEDGER_LIMIT" --max-rows "$ROW_LIMIT"
```

The command preserves its input and refuses an existing output directory. Its
three outputs are accompanied by `reconstruction.json`, with source/output
hashes, range and limits. It emits no `manifest.json`, registers no data, and
explicitly does not claim a complete dataset set. Output storage keys are
relative to the supplied scratch root. A reconstruction receipt alone is not
authority to remove existing registered data.

## Versioned retirement recovery

The explicit `--retirement-recovery` snapshot remains bound to the original
manifest, canonical replay, output descriptors and reconstruction evidence.
Version 1 retains its physical-removal semantics. Version 2 additionally requires
`namespaceRemoved` and `namespaceIntentSha256` on each retired output: an exact
intent digest when true, or an explicit null digest when false.

Namespace-only authority permits a missing eligible derived export without
claiming its physical storage has been released. If that file is present, its
type, length and digest are still checked. A present file under physical-removal
confirmation is rejected, because residency accounting already excludes it.
Canonical replay, the manifest and all noneligible outputs remain mandatory.

Compatible TypeScript and native readers must be deployed before the separate
additive namespace migration and any marker writes. The migration is not part
of automatic startup, does not change existing physical accounting, and refuses
rollback while namespace authority exists. The snapshot itself grants no file
removal or physical-capacity credit.
