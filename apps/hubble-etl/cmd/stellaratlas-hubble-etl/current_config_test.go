package main

import "testing"

func TestReservedCurrentWorkerConfigAndOneShotCompatibility(t *testing.T) {
	t.Setenv("ACTIVE_DATABASE_URL", "postgres://unused/test")
	t.Setenv("HUBBLE_ETL_RESERVE_CURRENT_WORKER", "true")
	t.Setenv("HUBBLE_ETL_WORKERS", "2")
	t.Setenv("HUBBLE_ETL_RECENT_BATCHES", "2")
	t.Setenv("HUBBLE_ETL_MAX_BATCHES", "4")
	t.Setenv("HUBBLE_ETL_PRIORITY_BATCH_ID", "")
	t.Setenv("HUBBLE_ETL_ADMISSION_ENABLED", "true")
	t.Setenv("HUBBLE_ETL_ONCE", "false")
	cfg, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.reserveCurrent || cfg.currentGuard == nil || cfg.currentGuard.MaximumFullBasisPoints != 4000 || cfg.currentGuard.MaximumSomeBasisPoints != 5000 || cfg.currentGuard.MaximumInflight != cfg.pressureGuard.MaximumInflight {
		t.Fatal("reserved current worker lost its bounded pressure policy")
	}
	t.Setenv("HUBBLE_ETL_WORKERS", "3")
	if cfg, err := loadConfig(); err != nil || cfg.workers != 3 || !cfg.reserveCurrent {
		t.Fatalf("reserved mode rejected three bounded workers: %v", err)
	}
	t.Setenv("HUBBLE_ETL_WORKERS", "4")
	if cfg, err := loadConfig(); err != nil || cfg.workers != 4 || !cfg.reserveCurrent {
		t.Fatalf("reserved mode rejected its four-worker ceiling: %v", err)
	}
	t.Setenv("HUBBLE_ETL_WORKERS", "5")
	if _, err := loadConfig(); err == nil {
		t.Fatal("reserved mode exceeded the four-worker cap")
	}
	t.Setenv("HUBBLE_ETL_WORKERS", "1")
	if _, err := loadConfig(); err == nil {
		t.Fatal("reserved mode accepted fewer than two workers")
	}
	t.Setenv("HUBBLE_ETL_WORKERS", "65")
	if _, err := loadConfig(); err == nil {
		t.Fatal("reserved mode exceeded the existing 64-worker cap")
	}
	t.Setenv("HUBBLE_ETL_WORKERS", "3")
	t.Setenv("HUBBLE_ETL_ONCE", "true")
	cfg, err = loadConfig()
	if err != nil || cfg.reserveCurrent {
		t.Fatalf("one-shot mode changed: %v", err)
	}
}
