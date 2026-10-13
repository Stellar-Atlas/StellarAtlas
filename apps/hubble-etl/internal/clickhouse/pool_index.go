package clickhouse

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"time"
)

const poolIndexStateType = "Tuple(UInt32, UInt64, DateTime64(6, 'UTC'), UUID, FixedString(64), String, String, UInt32, UInt64, Float64, String, String, String, Float64, String, String, String, Float64, Bool, DateTime64(6, 'UTC'), UInt32)"

type poolIndexUpdate struct {
	PoolID             string  `json:"pool_id"`
	LedgerSequence     uint32  `json:"ledger_sequence"`
	RowNumber          uint64  `json:"row_number"`
	IngestedAt         string  `json:"ingested_at"`
	BatchID            string  `json:"batch_id"`
	SourceSHA256       string  `json:"source_sha256"`
	PoolIDStrkey       string  `json:"pool_id_strkey"`
	PoolType           string  `json:"type"`
	PoolFee            uint32  `json:"fee"`
	TrustlineCount     uint64  `json:"trustline_count"`
	PoolShareCount     float64 `json:"pool_share_count"`
	AssetAType         string  `json:"asset_a_type"`
	AssetACode         string  `json:"asset_a_code"`
	AssetAIssuer       string  `json:"asset_a_issuer"`
	AssetAReserve      float64 `json:"asset_a_amount"`
	AssetBType         string  `json:"asset_b_type"`
	AssetBCode         string  `json:"asset_b_code"`
	AssetBIssuer       string  `json:"asset_b_issuer"`
	AssetBReserve      float64 `json:"asset_b_amount"`
	Deleted            bool    `json:"deleted"`
	ClosedAt           string  `json:"closed_at"`
	LastModifiedLedger uint32  `json:"last_modified_ledger"`
}

type poolSourceRow struct {
	PoolID             string  `json:"liquidity_pool_id"`
	PoolIDStrkey       string  `json:"liquidity_pool_id_strkey"`
	PoolType           string  `json:"type"`
	PoolFee            uint32  `json:"fee"`
	TrustlineCount     uint64  `json:"trustline_count"`
	PoolShareCount     float64 `json:"pool_share_count"`
	AssetAType         string  `json:"asset_a_type"`
	AssetACode         string  `json:"asset_a_code"`
	AssetAIssuer       string  `json:"asset_a_issuer"`
	AssetAReserve      float64 `json:"asset_a_amount"`
	AssetBType         string  `json:"asset_b_type"`
	AssetBCode         string  `json:"asset_b_code"`
	AssetBIssuer       string  `json:"asset_b_issuer"`
	AssetBReserve      float64 `json:"asset_b_amount"`
	Deleted            bool    `json:"deleted"`
	ClosedAt           string  `json:"closed_at"`
	LastModifiedLedger uint32  `json:"last_modified_ledger"`
}

func (c *Client) insertPoolIndexStage(ctx context.Context, rows []poolIndexUpdate) error {
	if len(rows) == 0 {
		return nil
	}
	var body bytes.Buffer
	encoder := json.NewEncoder(&body)
	for _, row := range rows {
		state := []any{row.LedgerSequence, row.RowNumber, row.IngestedAt, row.BatchID, row.SourceSHA256, row.PoolIDStrkey, row.PoolType, row.PoolFee, row.TrustlineCount, row.PoolShareCount, row.AssetAType, row.AssetACode, row.AssetAIssuer, row.AssetAReserve, row.AssetBType, row.AssetBCode, row.AssetBIssuer, row.AssetBReserve, row.Deleted, row.ClosedAt, row.LastModifiedLedger}
		wire := struct {
			PoolID       string `json:"pool_id"`
			State        []any  `json:"state"`
			BatchID      string `json:"batch_id"`
			SourceSHA256 string `json:"source_sha256"`
		}{row.PoolID, state, row.BatchID, row.SourceSHA256}
		if err := encoder.Encode(wire); err != nil {
			return err
		}
	}
	query := "INSERT INTO " + quoted(c.database) + "._asset_pool_stage (pool_id,state,batch_id,source_sha256) FORMAT JSONEachRow"
	if _, err := c.execute(ctx, query, nil, body.Bytes()); err != nil {
		return fmt.Errorf("insert pool staging rows: %w", err)
	}
	return nil
}

func (w *BatchWriter) capturePoolIndexRow(ctx context.Context, dataset string, ledger uint32, rowNumber uint64, ingested time.Time, identity BatchIdentity, encoded []byte) error {
	if dataset != "liquidity_pools" || w.poolIndexDisabled || w.poolIndexRows == nil {
		return nil
	}
	var source poolSourceRow
	if err := json.Unmarshal(encoded, &source); err != nil {
		return fmt.Errorf("decode pool index source row")
	}
	if source.PoolID == "" || source.PoolIDStrkey == "" || source.ClosedAt == "" {
		return fmt.Errorf("pool index source row lacks identity or close time")
	}
	closedAt, err := holderIndexDateTime(source.ClosedAt)
	if err != nil {
		return fmt.Errorf("pool index source row has invalid close time")
	}
	update := poolIndexUpdate{PoolID: source.PoolID, LedgerSequence: ledger, RowNumber: rowNumber, IngestedAt: ingested.UTC().Format("2006-01-02 15:04:05.000000"), BatchID: identity.ID, SourceSHA256: identity.SourceSHA256, PoolIDStrkey: source.PoolIDStrkey, PoolType: source.PoolType, PoolFee: source.PoolFee, TrustlineCount: source.TrustlineCount, PoolShareCount: source.PoolShareCount, AssetAType: source.AssetAType, AssetACode: source.AssetACode, AssetAIssuer: source.AssetAIssuer, AssetAReserve: source.AssetAReserve, AssetBType: source.AssetBType, AssetBCode: source.AssetBCode, AssetBIssuer: source.AssetBIssuer, AssetBReserve: source.AssetBReserve, Deleted: source.Deleted, ClosedAt: closedAt, LastModifiedLedger: source.LastModifiedLedger}
	if previous, ok := w.poolIndexRows[update.PoolID]; ok && !poolIndexLater(update, previous) {
		return nil
	}
	if previous, ok := w.poolIndexRows[update.PoolID]; ok {
		w.poolIndexBytes -= poolIndexUpdateBytes(previous)
	}
	w.poolIndexRows[update.PoolID] = update
	w.poolIndexBytes += poolIndexUpdateBytes(update)
	if len(w.poolIndexRows) >= w.limits.MaximumRows || w.poolIndexBytes >= w.limits.MaximumBytes {
		if err := w.flushPoolIndex(ctx); err != nil {
			return err
		}
	}
	return nil
}

func poolIndexLater(a, b poolIndexUpdate) bool {
	return a.LedgerSequence > b.LedgerSequence || (a.LedgerSequence == b.LedgerSequence && a.RowNumber > b.RowNumber)
}
func poolIndexUpdateBytes(row poolIndexUpdate) int {
	return len(row.PoolID) + len(row.PoolIDStrkey) + len(row.AssetACode) + len(row.AssetAIssuer) + len(row.AssetBCode) + len(row.AssetBIssuer) + 160
}

func (w *BatchWriter) flushPoolIndex(ctx context.Context) error {
	if len(w.poolIndexRows) == 0 {
		return nil
	}
	keys := make([]string, 0, len(w.poolIndexRows))
	for key := range w.poolIndexRows {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	rows := make([]poolIndexUpdate, 0, len(keys))
	for _, key := range keys {
		rows = append(rows, w.poolIndexRows[key])
	}
	if err := w.client.insertPoolIndexStage(ctx, rows); err != nil {
		return err
	}
	w.poolIndexStagedRows += uint64(len(rows))
	w.poolIndexRows = make(map[string]poolIndexUpdate)
	w.poolIndexBytes = 0
	return nil
}
