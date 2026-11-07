package main

import "testing"

func TestHistoryHoldConfigDefaultsOffWithoutAccess(t *testing.T) {
	t.Setenv("HUBBLE_ETL_HISTORY_HOLD_FILE", "")
	if hold := loadHistoryAdmissionHold(); hold != nil {
		t.Fatal("hold enabled by default")
	}
	// Configuration does not probe a path or reject the whole publisher. The
	// historical admission guard handles unavailable or unsafe state later.
	t.Setenv("HUBBLE_ETL_HISTORY_HOLD_FILE", "/unavailable/unsafe-control")
	hold := loadHistoryAdmissionHold()
	if hold == nil || hold.MarkerPath != "/unavailable/unsafe-control" {
		t.Fatal("configured hold was lost")
	}
	if cfg := backfillConfig(config{historyAdmissionHold: hold}); cfg.HistoryAdmissionHold != hold {
		t.Fatal("historical worker configuration lost its hold")
	}
}
