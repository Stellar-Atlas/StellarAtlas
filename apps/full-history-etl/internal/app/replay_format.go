package app

import "reflect"

// This historical SDK/XDR pair used the same Parquet writer and row models.
// Legacy layouts are explicit: neither compact ledger changes nor the older
// v2 row model can stand in for original v3 bytes. Other fields remain exact.
func knownLegacyReplayFormat(format ManifestFormat) bool {
	expected := writerFormat()
	expected.StellarSDK = "github.com/stellar/go-stellar-sdk@v0.6.0"
	expected.StellarXDRCommit = "68fa1ac55692f68ad2a2ca549d0a283273554439"
	return reflect.DeepEqual(format, expected)
}

func compatibleReplayFormat(format ManifestFormat, dataset, schema string) bool {
	if reflect.DeepEqual(format, writerFormat()) {
		return true
	}
	if !knownLegacyReplayFormat(format) {
		return false
	}
	switch dataset {
	case "transactions", "transaction-results", "operations", "ledgers", "transaction-meta":
		return schema == "stellar-atlas.full-history."+dataset+".v2"
	case "ledger-entry-changes", "contract-events":
		return schema == "stellar-atlas.full-history."+dataset+".v3"
	case "account-state-changes", "trustline-state-changes":
		return schema == "stellar-atlas.full-history."+dataset+".v1"
	default:
		return false
	}
}
