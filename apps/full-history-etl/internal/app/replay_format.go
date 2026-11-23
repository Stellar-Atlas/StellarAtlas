package app

import "reflect"

// This historical SDK/XDR pair used the same Parquet writer and row models.
// Only the three projections proven against its original compressed bytes may
// be made cold. Every other format field and SDK/XDR pairing remains exact.
func knownLegacyReplayFormat(format ManifestFormat) bool {
	expected := writerFormat()
	expected.StellarSDK = "github.com/stellar/go-stellar-sdk@v0.6.0"
	expected.StellarXDRCommit = "68fa1ac55692f68ad2a2ca549d0a283273554439"
	return reflect.DeepEqual(format, expected)
}

func compatibleReplayFormat(format ManifestFormat, dataset string) bool {
	if reflect.DeepEqual(format, writerFormat()) {
		return true
	}
	if !knownLegacyReplayFormat(format) {
		return false
	}
	switch dataset {
	case "transactions", "transaction-results", "operations":
		return true
	default:
		return false
	}
}
