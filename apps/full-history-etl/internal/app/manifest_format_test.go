package app

import (
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/stellar/go-stellar-sdk/xdr"
)

func TestManifestProducerMetadataMatchesPinnedDependency(t *testing.T) {
	module, err := os.ReadFile("../../go.mod")
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`(?m)^\s*github\.com/stellar/go-stellar-sdk v0\.8\.0\s*$`).Match(module) {
		t.Fatal("review manifest producer compatibility when changing the SDK dependency")
	}
	manifest := newManifest(Config{NetworkPassphrase: "test"}, ShardEvidence{}, nil)
	if manifest.Format.StellarSDK != "github.com/stellar/go-stellar-sdk@v0.8.0" {
		t.Fatal("manifest SDK does not describe the compiled dependency")
	}
	if manifest.Format.StellarXDRCommit != strings.TrimSpace(xdr.CommitHash) || manifest.Format.StellarXDRCommit != "4f524bbac80c781c06e4fb5fc93a2d0d331d6705" {
		t.Fatal("review backend SDK/XDR pair compatibility when generated XDR changes")
	}
}
