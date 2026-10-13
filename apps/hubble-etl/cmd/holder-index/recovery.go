package main

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

var recoveryUUID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
var recoveryDigest = regexp.MustCompile(`^[0-9a-fA-F]{64}$`)

type recoveryBatch struct {
	ID    string `json:"batch_id"`
	SHA   string `json:"source_sha256"`
	Start uint32 `json:"start_ledger"`
	End   uint32 `json:"end_ledger"`
}

// Recover only batches completed since the read model was initialized. This
// projects already parsed balance facts, never re-decodes the source archive.
func (i indexer) recover(ctx context.Context) error {
	body, err := i.execute(ctx, `SELECT toString(updated_at) AS since FROM `+i.database+`._asset_holder_index_assets FINAL WHERE asset_key='__started__' FORMAT JSON`, nil)
	if err != nil {
		return err
	}
	var epoch struct {
		Data []struct {
			Since string `json:"since"`
		} `json:"data"`
	}
	if err = json.Unmarshal(body, &epoch); err != nil {
		return err
	}
	if len(epoch.Data) != 1 {
		return fmt.Errorf("holder recovery epoch unavailable")
	}

	// A short grace lets the ordinary producer finish its promotion first.
	query := `SELECT batch_id,source_sha256,start_ledger,end_ledger
FROM ` + i.database + `._ingestion_batches FINAL
WHERE status='complete' AND updated_at>=toDateTime64({since:String},6,'UTC')
AND updated_at<now64(6)-INTERVAL 2 MINUTE
AND (batch_id,source_sha256) NOT IN (
 SELECT batch_id,source_sha256 FROM ` + i.database + `._asset_holder_index_batches FINAL
 WHERE status IN ('complete','rebuilt')
)
ORDER BY updated_at,batch_id LIMIT 100 FORMAT JSON`
	body, err = i.execute(ctx, query, url.Values{"param_since": {epoch.Data[0].Since}})
	if err != nil {
		return err
	}
	var pending struct {
		Data []recoveryBatch `json:"data"`
	}
	if err = json.Unmarshal(body, &pending); err != nil {
		return err
	}
	if len(pending.Data) == 0 {
		return nil
	}

	partitions := map[uint32][]string{}
	for _, batch := range pending.Data {
		if !recoveryUUID.MatchString(batch.ID) || !recoveryDigest.MatchString(batch.SHA) || batch.Start == 0 || batch.End < batch.Start || batch.End-batch.Start > 1048576 {
			return fmt.Errorf("invalid holder recovery source identity")
		}
		for partition := batch.Start / 1048576; partition <= batch.End/1048576; partition++ {
			partitions[partition] = append(partitions[partition], "'"+batch.ID+"'")
		}
	}
	keys := make([]uint32, 0, len(partitions))
	for partition := range partitions {
		keys = append(keys, partition)
	}
	sort.Slice(keys, func(a, b int) bool { return keys[a] < keys[b] })
	for _, partition := range keys {
		if err = i.checkBudget(ctx); err != nil {
			return err
		}
		params := url.Values{
			"param_part":    {strconv.FormatUint(uint64(partition), 10)},
			"param_batches": {"[" + strings.Join(partitions[partition], ",") + "]"},
		}
		for _, table := range []string{"trustlines", "accounts"} {
			predicate := " AND intDiv(_ledger_sequence,1048576)={part:UInt32} AND _batch_id IN {batches:Array(UUID)}"
			if _, err = i.execute(ctx, i.snapshotSQL(table, predicate), params); err != nil {
				return err
			}
		}
		logEvent("holder-recovery-partition", partition)
	}

	// A receipt is written only after every affected partition succeeded.
	// max(state) makes an interrupted projection safe to repeat.
	var records bytes.Buffer
	encoder := json.NewEncoder(&records)
	updated := time.Now().UTC().Format("2006-01-02 15:04:05.000000")
	for _, batch := range pending.Data {
		if err = encoder.Encode(map[string]any{
			"batch_id": batch.ID, "source_sha256": batch.SHA, "status": "rebuilt",
			"row_count": 0, "start_ledger": batch.Start, "end_ledger": batch.End, "updated_at": updated,
		}); err != nil {
			return err
		}
	}
	_, err = i.client.ExecuteHolderIndexSQL(ctx, "INSERT INTO "+i.database+"._asset_holder_index_batches FORMAT JSONEachRow", nil, records.Bytes())
	if err == nil {
		logEvent("holder-recovered-batches", len(pending.Data))
	}
	return err
}
