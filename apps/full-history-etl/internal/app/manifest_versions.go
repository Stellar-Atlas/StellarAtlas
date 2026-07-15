package app

import (
	"fmt"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/output"
)

const (
	manifestVersionV6 = "stellar-atlas.full-history-etl.manifest.v6"
	manifestVersionV7 = "stellar-atlas.full-history-etl.manifest.v7"
	manifestVersionV8 = "stellar-atlas.full-history-etl.manifest.v8"
)

var unsupportedV7 = []string{
	"ledger-close-upgrades-and-extension-values",
	"transaction-envelope-details",
	"operation-result-details",
	"effects",
	"accounts",
	"assets",
	"trustlines",
	"offers",
	"liquidity-pools",
	"contracts",
	"contract-data-values",
	"contract-code-values",
	"operation-type-details",
	"transaction-meta-values",
	"ttl-entries",
	"config-settings",
	"restored-keys",
}

var unsupportedV8 = []string{
	"ledger-close-upgrades-and-extension-values",
	"transaction-envelope-details",
	"operation-result-details",
	"effects",
	"account-current-state-and-signers",
	"assets",
	"trustline-current-state",
	"offers",
	"liquidity-pools",
	"contracts",
	"contract-data-values",
	"contract-code-values",
	"operation-type-details",
	"transaction-meta-values",
	"ttl-entries",
	"config-settings",
	"restored-keys",
}

func isSupportedManifestVersion(version string) bool {
	return version == manifestVersionV6 || version == manifestVersionV7 || version == manifestVersionV8
}

func unsupportedDatasetsForVersion(version string) ([]string, error) {
	switch version {
	case manifestVersionV6:
		result := append([]string{}, unsupportedV7[:12]...)
		result = append(result, "contract-event-topics-and-data", "ledger-entry-keys-and-values")
		return append(result, unsupportedV7[12:]...), nil
	case manifestVersionV7:
		return append([]string{}, unsupportedV7...), nil
	case manifestVersionV8:
		return append([]string{}, unsupportedV8...), nil
	default:
		return nil, fmt.Errorf("unsupported manifest version %q", version)
	}
}

func outputSpecificationsForVersion(version string) ([]output.Specification, error) {
	specifications := output.Specifications()
	switch version {
	case manifestVersionV8:
		return specifications, nil
	case manifestVersionV6, manifestVersionV7:
		specifications = specifications[:8]
		if version == manifestVersionV6 {
			specifications[6].SchemaVersion = "stellar-atlas.full-history.contract-events.v2"
			specifications[7].SchemaVersion = "stellar-atlas.full-history.ledger-entry-changes.v2"
		}
		return specifications, nil
	default:
		return nil, fmt.Errorf("unsupported manifest version %q", version)
	}
}
