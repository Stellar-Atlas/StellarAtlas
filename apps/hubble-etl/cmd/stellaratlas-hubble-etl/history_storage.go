package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/clickhouse"
)

const historyStoragePolicyEnv = "HUBBLE_ETL_HISTORY_BULK_CAPACITY_POLICY"

func loadHistoryStoragePolicy(reserveCurrent bool) (*clickhouse.HistoricalStoragePolicy, error) {
	value, configured := os.LookupEnv(historyStoragePolicyEnv)
	if !configured || value == "" {
		return nil, nil
	}
	if !reserveCurrent {
		return nil, fmt.Errorf("%s requires continuous reserved-current mode", historyStoragePolicyEnv)
	}
	if len(value) > 4096 {
		return nil, fmt.Errorf("%s exceeds configuration size limit", historyStoragePolicyEnv)
	}
	var policy clickhouse.HistoricalStoragePolicy
	decoder := json.NewDecoder(strings.NewReader(value))
	invalid := fmt.Errorf("%s must contain one capacity policy object with all six exact fields", historyStoragePolicyEnv)
	if token, err := decoder.Token(); err != nil || token != json.Delim('{') {
		return nil, invalid
	}
	keys := map[string]bool{
		"bulkRoot": false, "sourceMinimumFreeBytes": false, "sourceMinimumFreeBasisPoints": false,
		"sourceCycleOutputBytes": false, "currentWarehouseMarginBytes": false, "unreservedGrowthPerHistorySlotBytes": false,
	}
	for decoder.More() {
		token, err := decoder.Token()
		key, isString := token.(string)
		seen, known := keys[key]
		if err != nil || !isString || !known || seen || decoder.Decode(new(json.RawMessage)) != nil {
			return nil, invalid
		}
		keys[key] = true
	}
	if token, err := decoder.Token(); err != nil || token != json.Delim('}') || decoder.Decode(new(any)) != io.EOF {
		return nil, invalid
	}
	for _, seen := range keys {
		if !seen {
			return nil, invalid
		}
	}
	if err := json.Unmarshal([]byte(value), &policy); err != nil {
		return nil, invalid
	}
	if err := policy.Validate(); err != nil {
		return nil, fmt.Errorf("%s: %w", historyStoragePolicyEnv, err)
	}
	return &policy, nil
}
