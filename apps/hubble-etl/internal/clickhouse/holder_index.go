package clickhouse

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

const holderIndexStateType = "Tuple(UInt32, UInt64, DateTime64(6, 'UTC'), Float64, Float64, Float64, Int64, UInt32, Bool, UInt32, String, UUID, FixedString(64), String, DateTime64(6, 'UTC'))"

var holderIndexParameterPattern = regexp.MustCompile(`^param_[A-Za-z][A-Za-z0-9_]*$`)

type holderIndexUpdate struct {
	AssetKey           string  `json:"asset_key"`
	AccountID          string  `json:"account_id"`
	LedgerSequence     uint32  `json:"ledger_sequence"`
	RowNumber          uint64  `json:"row_number"`
	IngestedAt         string  `json:"ingested_at"`
	Balance            float64 `json:"balance"`
	BuyingLiabilities  float64 `json:"buying_liabilities"`
	SellingLiabilities float64 `json:"selling_liabilities"`
	TrustlineLimit     int64   `json:"trust_line_limit"`
	Flags              uint32  `json:"flags"`
	Deleted            bool    `json:"deleted"`
	LastModifiedLedger uint32  `json:"last_modified_ledger"`
	HomeDomain         string  `json:"home_domain"`
	BatchID            string  `json:"batch_id"`
	SourceSHA256       string  `json:"source_sha256"`
	Sponsor            string  `json:"sponsor"`
	ClosedAt           string  `json:"closed_at"`
}

type holderSourceRow struct {
	AccountID          string          `json:"account_id"`
	AssetType          string          `json:"asset_type"`
	AssetCode          string          `json:"asset_code"`
	AssetIssuer        string          `json:"asset_issuer"`
	Balance            float64         `json:"balance"`
	BuyingLiabilities  float64         `json:"buying_liabilities"`
	SellingLiabilities float64         `json:"selling_liabilities"`
	TrustlineLimit     int64           `json:"trust_line_limit"`
	Flags              uint32          `json:"flags"`
	Deleted            bool            `json:"deleted"`
	LastModifiedLedger uint32          `json:"last_modified_ledger"`
	HomeDomain         string          `json:"home_domain"`
	Sponsor            json.RawMessage `json:"sponsor"`
	ClosedAt           string          `json:"closed_at"`
}

// InitializeHolderIndex creates only the opt-in read-model tables.
func (c *Client) InitializeHolderIndex(ctx context.Context) error {
	if !c.holderIndexEnabled {
		return nil
	}
	db := quoted(c.database)
	statements := []string{
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s._asset_holder_current (
	asset_key String,
	account_id String,
	state SimpleAggregateFunction(max, %s)
) ENGINE = AggregatingMergeTree
ORDER BY (asset_key, account_id)
SETTINGS storage_policy = '%s'`, db, holderIndexStateType, c.holderIndexStoragePolicy),
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s._asset_holder_stage (
	asset_key String,
	account_id String,
	state SimpleAggregateFunction(max, %s),
	batch_id UUID,
	source_sha256 FixedString(64),
	created_at DateTime DEFAULT now()
) ENGINE = AggregatingMergeTree
PARTITION BY toDate(created_at)
ORDER BY (batch_id, source_sha256, asset_key, account_id)
TTL created_at + INTERVAL 2 DAY DELETE
SETTINGS storage_policy = '%s'`, db, holderIndexStateType, c.holderIndexStoragePolicy),
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s._asset_holder_index_batches (
	batch_id UUID,
	source_sha256 FixedString(64),
	status String,
	row_count UInt64,
	start_ledger UInt32,
	end_ledger UInt32,
	updated_at DateTime64(6, 'UTC')
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (batch_id, source_sha256)
SETTINGS storage_policy = '%s'`, db, c.holderIndexStoragePolicy),
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s._asset_holder_index_assets (
	asset_key String,
	status String,
	updated_at DateTime64(6, 'UTC'),
	error String
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY asset_key
SETTINGS storage_policy = '%s'`, db, c.holderIndexStoragePolicy),
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s._asset_pool_current (
	pool_id String,
	state SimpleAggregateFunction(max, %s)
) ENGINE = AggregatingMergeTree
ORDER BY pool_id
SETTINGS storage_policy = '%s'`, db, poolIndexStateType, c.holderIndexStoragePolicy),
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s._asset_pool_stage (
	pool_id String,
	state SimpleAggregateFunction(max, %s),
	batch_id UUID,
	source_sha256 FixedString(64),
	created_at DateTime DEFAULT now()
) ENGINE = AggregatingMergeTree
PARTITION BY toDate(created_at)
ORDER BY (batch_id, source_sha256, pool_id)
TTL created_at + INTERVAL 2 DAY DELETE
SETTINGS storage_policy = '%s'`, db, poolIndexStateType, c.holderIndexStoragePolicy),
	}
	for _, statement := range statements {
		if _, err := c.execute(ctx, statement, nil, nil); err != nil {
			return fmt.Errorf("initialize asset holder index: %w", err)
		}
	}
	marker := fmt.Sprintf(`INSERT INTO %s._asset_holder_index_assets
SELECT '__started__', 'initialized',
	ifNull((SELECT minOrNull(updated_at) FROM %s._asset_holder_index_assets), now64(6)), ''
WHERE NOT EXISTS (
	SELECT 1 FROM %s._asset_holder_index_assets FINAL WHERE asset_key = '__started__'
)`, db, db, db)
	if _, err := c.execute(ctx, marker, nil, nil); err != nil {
		return fmt.Errorf("initialize asset holder index marker: %w", err)
	}
	return nil
}

// PromoteHolderIndex publishes a staged batch only after its source batch is complete.
func (c *Client) PromoteHolderIndex(
	ctx context.Context,
	identity BatchIdentity,
	rowCount uint64,
) error {
	if !c.holderIndexEnabled {
		return nil
	}
	if !validHolderIdentity(identity) {
		return fmt.Errorf("invalid asset holder index batch identity")
	}
	params := url.Values{
		"param_batch":  {identity.ID},
		"param_digest": {identity.SourceSHA256},
	}
	base := quoted(c.database)
	completed, err := c.execute(ctx, "SELECT count() FROM "+base+
		"._ingestion_batches FINAL WHERE batch_id={batch:UUID} AND source_sha256={digest:String} AND status='complete' FORMAT TabSeparated", params, nil)
	if err != nil {
		return fmt.Errorf("check source batch before holder promotion: %w", err)
	}
	if strings.TrimSpace(string(completed)) != "1" {
		return fmt.Errorf("source batch is not complete; holder index remains staged")
	}
	if rowCount > 0 {
		staged, err := c.execute(ctx, "SELECT count() FROM "+base+
			"._asset_holder_stage WHERE batch_id={batch:UUID} AND source_sha256={digest:String} FORMAT TabSeparated", params, nil)
		if err != nil {
			return fmt.Errorf("verify staged holder rows: %w", err)
		}
		count, parseErr := strconv.ParseUint(strings.TrimSpace(string(staged)), 10, 64)
		if parseErr != nil || count == 0 {
			return fmt.Errorf("staged holder rows are empty for nonempty batch")
		}
		query := "INSERT INTO " + base +
			"._asset_holder_current (asset_key, account_id, state) SELECT asset_key, account_id, max(state) FROM " + base +
			"._asset_holder_stage WHERE batch_id={batch:UUID} AND source_sha256={digest:String} GROUP BY asset_key, account_id"
		if _, err := c.execute(ctx, query, params, nil); err != nil {
			return fmt.Errorf("promote staged holder rows: %w", err)
		}
	}
	poolStageCount, err := c.execute(ctx, "SELECT count() FROM "+base+
		"._asset_pool_stage WHERE batch_id={batch:UUID} AND source_sha256={digest:String} FORMAT TabSeparated", params, nil)
	if err != nil {
		return fmt.Errorf("verify staged pool rows: %w", err)
	}
	poolCount, parseErr := strconv.ParseUint(strings.TrimSpace(string(poolStageCount)), 10, 64)
	if parseErr != nil {
		return fmt.Errorf("decode staged pool row count: %w", parseErr)
	}
	if poolCount > 0 {
		query := "INSERT INTO " + base +
			"._asset_pool_current (pool_id,state) SELECT pool_id,max(state) FROM " + base +
			"._asset_pool_stage WHERE batch_id={batch:UUID} AND source_sha256={digest:String} GROUP BY pool_id"
		if _, err := c.execute(ctx, query, params, nil); err != nil {
			return fmt.Errorf("promote staged pool rows: %w", err)
		}
	}
	if err := c.recordHolderIndexBatch(ctx, identity, "complete", rowCount); err != nil {
		return fmt.Errorf("mark holder index batch complete: %w", err)
	}
	return nil
}

// ExecuteHolderIndexSQL exposes bounded parameterized queries to the rebuild CLI.
// Parameter keys use ClickHouse HTTP's param_ prefix and each key must be singular.
func (c *Client) ExecuteHolderIndexSQL(
	ctx context.Context,
	query string,
	parameters url.Values,
	body []byte,
) ([]byte, error) {
	if !c.holderIndexEnabled {
		return nil, fmt.Errorf("asset holder index is disabled")
	}
	if strings.TrimSpace(query) == "" || len(query) > 1<<20 {
		return nil, fmt.Errorf("invalid asset holder index query")
	}
	for name, values := range parameters {
		if !holderIndexParameterPattern.MatchString(name) || len(values) != 1 {
			return nil, fmt.Errorf("invalid asset holder index query parameter")
		}
	}
	return c.execute(ctx, query, parameters, body)
}

func (c *Client) insertHolderIndexStage(ctx context.Context, rows []holderIndexUpdate) error {
	if len(rows) == 0 {
		return nil
	}
	var body bytes.Buffer
	encoder := json.NewEncoder(&body)
	for _, row := range rows {
		wireRow := struct {
			AssetKey     string `json:"asset_key"`
			AccountID    string `json:"account_id"`
			State        []any  `json:"state"`
			BatchID      string `json:"batch_id"`
			SourceSHA256 string `json:"source_sha256"`
		}{
			AssetKey:  row.AssetKey,
			AccountID: row.AccountID,
			State: []any{
				row.LedgerSequence, row.RowNumber, row.IngestedAt, row.Balance,
				row.BuyingLiabilities, row.SellingLiabilities, row.TrustlineLimit,
				row.Flags, row.Deleted, row.LastModifiedLedger, row.HomeDomain,
				row.BatchID, row.SourceSHA256, row.Sponsor, row.ClosedAt,
			},
			BatchID: row.BatchID, SourceSHA256: row.SourceSHA256,
		}
		if err := encoder.Encode(wireRow); err != nil {
			return err
		}
	}
	query := "INSERT INTO " + quoted(c.database) +
		"._asset_holder_stage (asset_key, account_id, state, batch_id, source_sha256) FORMAT JSONEachRow"
	if _, err := c.execute(ctx, query, nil, body.Bytes()); err != nil {
		return fmt.Errorf("insert holder staging rows: %w", err)
	}
	return nil
}

func (c *Client) recordHolderIndexBatch(
	ctx context.Context,
	identity BatchIdentity,
	status string,
	rowCount uint64,
) error {
	row := struct {
		BatchID      string `json:"batch_id"`
		SourceSHA256 string `json:"source_sha256"`
		Status       string `json:"status"`
		RowCount     uint64 `json:"row_count"`
		StartLedger  uint32 `json:"start_ledger"`
		EndLedger    uint32 `json:"end_ledger"`
		UpdatedAt    string `json:"updated_at"`
	}{
		BatchID:      identity.ID,
		SourceSHA256: identity.SourceSHA256,
		Status:       status,
		RowCount:     rowCount,
		StartLedger:  identity.StartLedger,
		EndLedger:    identity.EndLedger,
		UpdatedAt:    time.Now().UTC().Format(time.RFC3339Nano),
	}
	body, err := json.Marshal(row)
	if err != nil {
		return err
	}
	body = append(body, '\n')
	query := "INSERT INTO " + quoted(c.database) +
		"._asset_holder_index_batches SETTINGS async_insert=0 FORMAT JSONEachRow"
	if _, err := c.execute(ctx, query, nil, body); err != nil {
		return err
	}
	return nil
}

func (w *BatchWriter) captureHolderIndexRow(
	ctx context.Context,
	dataset string,
	ledgerSequence uint32,
	rowNumber uint64,
	encoded []byte,
) error {
	if w.holderIndexDisabled || w.holderIndexRows == nil {
		return nil
	}
	update, include, err := decodeHolderIndexUpdate(
		dataset,
		ledgerSequence,
		rowNumber,
		w.ingestedAt,
		w.identity,
		encoded,
	)
	if err != nil || !include {
		return err
	}
	key := update.AssetKey + "\x00" + update.AccountID
	if previous, ok := w.holderIndexRows[key]; ok && !holderIndexLater(update, previous) {
		return nil
	}
	if previous, ok := w.holderIndexRows[key]; ok {
		w.holderIndexBytes -= holderIndexUpdateBytes(previous)
	}
	w.holderIndexRows[key] = update
	w.holderIndexBytes += holderIndexUpdateBytes(update)
	if len(w.holderIndexRows) >= w.limits.MaximumRows || w.holderIndexBytes >= w.limits.MaximumBytes {
		if err := w.flushHolderIndex(ctx); err != nil {
			return err
		}
	}
	return nil
}

func decodeHolderIndexUpdate(
	dataset string,
	ledgerSequence uint32,
	rowNumber uint64,
	ingestedAt time.Time,
	identity BatchIdentity,
	encoded []byte,
) (holderIndexUpdate, bool, error) {
	if dataset != "accounts" && dataset != "trustlines" {
		return holderIndexUpdate{}, false, nil
	}
	var row holderSourceRow
	if err := json.Unmarshal(encoded, &row); err != nil {
		return holderIndexUpdate{}, false, fmt.Errorf("decode holder index source row")
	}
	if row.AccountID == "" || row.ClosedAt == "" {
		return holderIndexUpdate{}, false, fmt.Errorf("holder index source row lacks account or close time")
	}
	closedAt, err := holderIndexDateTime(row.ClosedAt)
	if err != nil {
		return holderIndexUpdate{}, false, fmt.Errorf("holder index source row has invalid close time")
	}
	assetKey := "native"
	if dataset == "trustlines" {
		if row.AssetType != "credit_alphanum4" && row.AssetType != "credit_alphanum12" {
			return holderIndexUpdate{}, false, nil
		}
		if row.AssetCode == "" || row.AssetIssuer == "" {
			return holderIndexUpdate{}, false, fmt.Errorf("holder trustline lacks asset identity")
		}
		assetKey = row.AssetCode + ":" + row.AssetIssuer
	}
	sponsor := ""
	if len(row.Sponsor) > 0 && string(row.Sponsor) != "null" {
		if err := json.Unmarshal(row.Sponsor, &sponsor); err != nil {
			var object struct {
				String string `json:"String"`
				Valid  bool   `json:"Valid"`
			}
			if json.Unmarshal(row.Sponsor, &object) == nil && object.Valid {
				sponsor = object.String
			}
		}
	}
	return holderIndexUpdate{
		AssetKey:           assetKey,
		AccountID:          row.AccountID,
		LedgerSequence:     ledgerSequence,
		RowNumber:          rowNumber,
		IngestedAt:         ingestedAt.UTC().Format("2006-01-02 15:04:05.000000"),
		Balance:            row.Balance,
		BuyingLiabilities:  row.BuyingLiabilities,
		SellingLiabilities: row.SellingLiabilities,
		TrustlineLimit:     row.TrustlineLimit,
		Flags:              row.Flags,
		Deleted:            row.Deleted,
		LastModifiedLedger: row.LastModifiedLedger,
		HomeDomain:         row.HomeDomain,
		BatchID:            identity.ID,
		SourceSHA256:       identity.SourceSHA256,
		Sponsor:            sponsor,
		ClosedAt:           closedAt,
	}, true, nil
}

func holderIndexDateTime(value string) (string, error) {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return "", err
	}
	return parsed.UTC().Format("2006-01-02 15:04:05.000000"), nil
}

func holderIndexLater(left, right holderIndexUpdate) bool {
	return left.LedgerSequence > right.LedgerSequence ||
		(left.LedgerSequence == right.LedgerSequence && left.RowNumber > right.RowNumber)
}

func holderIndexUpdateBytes(row holderIndexUpdate) int {
	return len(row.AssetKey) + len(row.AccountID) + len(row.HomeDomain) +
		len(row.Sponsor) + len(row.ClosedAt) + 192
}

func (w *BatchWriter) flushHolderIndex(ctx context.Context) error {
	if len(w.holderIndexRows) == 0 {
		return nil
	}
	keys := make([]string, 0, len(w.holderIndexRows))
	for key := range w.holderIndexRows {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	rows := make([]holderIndexUpdate, 0, len(keys))
	for _, key := range keys {
		rows = append(rows, w.holderIndexRows[key])
	}
	if err := w.client.insertHolderIndexStage(ctx, rows); err != nil {
		return err
	}
	w.holderIndexStagedRows += uint64(len(rows))
	w.holderIndexRows = make(map[string]holderIndexUpdate)
	w.holderIndexBytes = 0
	return nil
}

func validHolderIdentity(identity BatchIdentity) bool {
	return uuidPattern.MatchString(identity.ID) && digestPattern.MatchString(identity.SourceSHA256) &&
		identity.StartLedger > 0 && identity.EndLedger >= identity.StartLedger
}
