package model

// AccountStateChange is one account image from normalized ledger entry change
// history. Removed entries retain their final pre-change image with Deleted set.
type AccountStateChange struct {
	LedgerSequence       int64    `parquet:"name=ledger_sequence, type=INT64, convertedtype=UINT_64"`
	TransactionIndex     int64    `parquet:"name=transaction_index, type=INT64, convertedtype=UINT_64"`
	ChangeIndex          int64    `parquet:"name=change_index, type=INT64, convertedtype=UINT_64"`
	TransactionHash      string   `parquet:"name=transaction_hash, type=BYTE_ARRAY, convertedtype=UTF8"`
	Reason               string   `parquet:"name=reason, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY"`
	OperationIndex       int64    `parquet:"name=operation_index, type=INT64, convertedtype=UINT_64"`
	HasOperationIndex    bool     `parquet:"name=has_operation_index, type=BOOLEAN"`
	UpgradeIndex         int64    `parquet:"name=upgrade_index, type=INT64, convertedtype=UINT_64"`
	HasUpgradeIndex      bool     `parquet:"name=has_upgrade_index, type=BOOLEAN"`
	ChangeType           int32    `parquet:"name=change_type, type=INT32"`
	ChangeTypeString     string   `parquet:"name=change_type_string, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY"`
	Deleted              bool     `parquet:"name=deleted, type=BOOLEAN"`
	LedgerKeySHA256      string   `parquet:"name=ledger_key_sha256, type=BYTE_ARRAY, convertedtype=UTF8"`
	StateEntryXDR        string   `parquet:"name=state_entry_xdr, type=BYTE_ARRAY"`
	LastModifiedLedger   int64    `parquet:"name=last_modified_ledger, type=INT64, convertedtype=UINT_64"`
	Sponsor              string   `parquet:"name=sponsor, type=BYTE_ARRAY, convertedtype=UTF8"`
	HasSponsor           bool     `parquet:"name=has_sponsor, type=BOOLEAN"`
	ClosedAtUnixMillis   int64    `parquet:"name=closed_at_unix_millis, type=INT64, convertedtype=TIMESTAMP_MILLIS"`
	AccountID            string   `parquet:"name=account_id, type=BYTE_ARRAY, convertedtype=UTF8"`
	Balance              int64    `parquet:"name=balance, type=INT64"`
	BuyingLiabilities    int64    `parquet:"name=buying_liabilities, type=INT64"`
	SellingLiabilities   int64    `parquet:"name=selling_liabilities, type=INT64"`
	SequenceNumber       int64    `parquet:"name=sequence_number, type=INT64"`
	SequenceLedger       int64    `parquet:"name=sequence_ledger, type=INT64, convertedtype=UINT_64"`
	SequenceTime         int64    `parquet:"name=sequence_time, type=INT64, convertedtype=UINT_64"`
	HasSequenceMetadata  bool     `parquet:"name=has_sequence_metadata, type=BOOLEAN"`
	SubentryCount        int64    `parquet:"name=subentry_count, type=INT64, convertedtype=UINT_64"`
	Flags                int64    `parquet:"name=flags, type=INT64, convertedtype=UINT_64"`
	HomeDomain           string   `parquet:"name=home_domain, type=BYTE_ARRAY, convertedtype=UTF8"`
	InflationDestination string   `parquet:"name=inflation_destination, type=BYTE_ARRAY, convertedtype=UTF8"`
	HasInflationDest     bool     `parquet:"name=has_inflation_destination, type=BOOLEAN"`
	MasterWeight         int32    `parquet:"name=master_weight, type=INT32"`
	LowThreshold         int32    `parquet:"name=low_threshold, type=INT32"`
	MediumThreshold      int32    `parquet:"name=medium_threshold, type=INT32"`
	HighThreshold        int32    `parquet:"name=high_threshold, type=INT32"`
	SponsoredEntryCount  int64    `parquet:"name=sponsored_entry_count, type=INT64, convertedtype=UINT_64"`
	SponsoringEntryCount int64    `parquet:"name=sponsoring_entry_count, type=INT64, convertedtype=UINT_64"`
	SignerCount          int64    `parquet:"name=signer_count, type=INT64, convertedtype=UINT_64"`
	SignerKeys           []string `parquet:"name=signer_keys, type=BYTE_ARRAY, convertedtype=UTF8, repetitiontype=REPEATED"`
	SignerWeights        []int32  `parquet:"name=signer_weights, type=INT32, repetitiontype=REPEATED"`
	SignerSponsors       []string `parquet:"name=signer_sponsors, type=BYTE_ARRAY, convertedtype=UTF8, repetitiontype=REPEATED"`
}

// TrustlineStateChange is one trustline image from normalized ledger entry
// change history. Credit assets use code/issuer identity; pool shares use pool ID.
type TrustlineStateChange struct {
	LedgerSequence        int64  `parquet:"name=ledger_sequence, type=INT64, convertedtype=UINT_64"`
	TransactionIndex      int64  `parquet:"name=transaction_index, type=INT64, convertedtype=UINT_64"`
	ChangeIndex           int64  `parquet:"name=change_index, type=INT64, convertedtype=UINT_64"`
	TransactionHash       string `parquet:"name=transaction_hash, type=BYTE_ARRAY, convertedtype=UTF8"`
	Reason                string `parquet:"name=reason, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY"`
	OperationIndex        int64  `parquet:"name=operation_index, type=INT64, convertedtype=UINT_64"`
	HasOperationIndex     bool   `parquet:"name=has_operation_index, type=BOOLEAN"`
	UpgradeIndex          int64  `parquet:"name=upgrade_index, type=INT64, convertedtype=UINT_64"`
	HasUpgradeIndex       bool   `parquet:"name=has_upgrade_index, type=BOOLEAN"`
	ChangeType            int32  `parquet:"name=change_type, type=INT32"`
	ChangeTypeString      string `parquet:"name=change_type_string, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY"`
	Deleted               bool   `parquet:"name=deleted, type=BOOLEAN"`
	LedgerKeySHA256       string `parquet:"name=ledger_key_sha256, type=BYTE_ARRAY, convertedtype=UTF8"`
	StateEntryXDR         string `parquet:"name=state_entry_xdr, type=BYTE_ARRAY"`
	LastModifiedLedger    int64  `parquet:"name=last_modified_ledger, type=INT64, convertedtype=UINT_64"`
	Sponsor               string `parquet:"name=sponsor, type=BYTE_ARRAY, convertedtype=UTF8"`
	HasSponsor            bool   `parquet:"name=has_sponsor, type=BOOLEAN"`
	ClosedAtUnixMillis    int64  `parquet:"name=closed_at_unix_millis, type=INT64, convertedtype=TIMESTAMP_MILLIS"`
	AccountID             string `parquet:"name=account_id, type=BYTE_ARRAY, convertedtype=UTF8"`
	AssetType             int32  `parquet:"name=asset_type, type=INT32"`
	AssetTypeString       string `parquet:"name=asset_type_string, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY"`
	AssetCode             string `parquet:"name=asset_code, type=BYTE_ARRAY, convertedtype=UTF8"`
	AssetIssuer           string `parquet:"name=asset_issuer, type=BYTE_ARRAY, convertedtype=UTF8"`
	LiquidityPoolID       string `parquet:"name=liquidity_pool_id, type=BYTE_ARRAY, convertedtype=UTF8"`
	Balance               int64  `parquet:"name=balance, type=INT64"`
	Limit                 int64  `parquet:"name=limit, type=INT64"`
	BuyingLiabilities     int64  `parquet:"name=buying_liabilities, type=INT64"`
	SellingLiabilities    int64  `parquet:"name=selling_liabilities, type=INT64"`
	LiquidityPoolUseCount int32  `parquet:"name=liquidity_pool_use_count, type=INT32"`
	Flags                 int64  `parquet:"name=flags, type=INT64, convertedtype=UINT_64"`
}
