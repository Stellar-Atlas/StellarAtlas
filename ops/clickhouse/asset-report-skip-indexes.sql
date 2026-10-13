-- Optional skip indexes for classic-asset trade report lookups.
-- Apply to the Hubble warehouse database before materializing indexes on
-- selected partitions. The tuple matches the report's exact code + issuer
-- equality predicates; no table copy or historical backfill is required.

-- Apply:
ALTER TABLE history_trades
    ADD INDEX IF NOT EXISTS idx_report_selling_asset_pair
    (selling_asset_code, selling_asset_issuer)
    TYPE bloom_filter(0.01) GRANULARITY 4;

ALTER TABLE history_trades
    ADD INDEX IF NOT EXISTS idx_report_buying_asset_pair
    (buying_asset_code, buying_asset_issuer)
    TYPE bloom_filter(0.01) GRANULARITY 4;

-- Roll back:
-- ALTER TABLE history_trades DROP INDEX IF EXISTS idx_report_selling_asset_pair;
-- ALTER TABLE history_trades DROP INDEX IF EXISTS idx_report_buying_asset_pair;
