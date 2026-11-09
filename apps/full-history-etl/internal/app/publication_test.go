package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunPublishesViaExplicitStagingRoot(t *testing.T) {
	root := t.TempDir()
	stagingRoot := t.TempDir()
	outputDirectory := filepath.Join(root, "network=pubnet", "range=53312000-53312000")
	config := fixtureConfig(root, outputDirectory)
	config.PublicationStagingRoot = stagingRoot

	receipt, err := Run(context.Background(), config)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if receipt.ManifestStorageKey == "" {
		t.Fatal("publication receipt is missing its manifest storage key")
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(receipt.ManifestStorageKey))); err != nil {
		t.Fatalf("published manifest: %v", err)
	}
	entries, err := os.ReadDir(stagingRoot)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != ".publish.lock" {
		t.Fatalf("staging root retained unexpected artifacts: %v", entries)
	}
}

func TestValidatePublicationStagingRootRejectsUnsafeOverlap(t *testing.T) {
	root := t.TempDir()
	if err := validatePublicationStagingRoot(root, root); err == nil {
		t.Fatal("expected overlapping staging root rejection")
	}
	if err := validatePublicationStagingRoot(root, "relative"); err == nil {
		t.Fatal("expected relative staging root rejection")
	}
	if err := validatePublicationStagingRoot(root, filepath.Join(filepath.Dir(root), "spool")); err != nil {
		t.Fatalf("disjoint staging root: %v", err)
	}
}

func TestRunCurrentBulkCommitGuardRefusesSameDeviceBeforePublicationCopy(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "typed")
	stagingRoot := filepath.Join(base, "staging")
	outputDirectory := filepath.Join(root, "network=pubnet", "range=53312000-53312000")
	config := fixtureConfig(root, outputDirectory)
	config.PublicationStagingRoot = stagingRoot
	config.CurrentBulkCommitGuard = true

	if _, err := Run(context.Background(), config); err == nil || !strings.Contains(err.Error(), "same filesystem device") {
		t.Fatalf("expected same-device publication refusal, got %v", err)
	}
	entries, err := os.ReadDir(filepath.Dir(outputDirectory))
	if err != nil || len(entries) != 0 {
		t.Fatalf("destination parent has unexpected publication artifacts: %v, %v", entries, err)
	}
	entries, err = os.ReadDir(stagingRoot)
	if err != nil || len(entries) != 1 || entries[0].Name() != ".publish.lock" {
		t.Fatalf("staging root did not reach the lock and clean up: %v, %v", entries, err)
	}
}
