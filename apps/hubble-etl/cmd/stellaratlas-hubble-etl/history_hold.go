package main

import (
	"encoding/json"
	"os"
	"strings"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/backfill"
)

func loadHistoryAdmissionHold() *backfill.HistoryAdmissionHold {
	marker := strings.TrimSpace(os.Getenv("HUBBLE_ETL_HISTORY_HOLD_FILE"))
	if marker == "" {
		return nil
	}
	return &backfill.HistoryAdmissionHold{
		MarkerPath: marker,
		Log: func(event, reason string) {
			_ = json.NewEncoder(os.Stdout).Encode(map[string]string{
				"event": event, "reason": reason, "lane": "history",
			})
		},
	}
}
