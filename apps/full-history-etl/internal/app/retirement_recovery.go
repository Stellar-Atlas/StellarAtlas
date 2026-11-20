package app

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"regexp"
	"strconv"
	"strings"
)

type derivedRetirementRecovery struct {
	Version         int                       `json:"version"`
	BatchID         string                    `json:"batchId"`
	NetworkID       string                    `json:"networkIdSha256"`
	Start           uint32                    `json:"startLedger"`
	End             uint32                    `json:"endLedger"`
	ManifestSHA256  string                    `json:"manifestSha256"`
	CanonicalSHA256 string                    `json:"canonicalSha256"`
	Outputs         []derivedRetirementOutput `json:"outputs"`
}
type derivedRetirementOutput struct {
	Dataset               string  `json:"dataset"`
	SHA256                string  `json:"outputSha256"`
	Bytes                 string  `json:"byteCount"`
	Rows                  string  `json:"recordCount"`
	StorageKey            string  `json:"storageKey"`
	Removed               bool    `json:"removed"`
	EvidenceSHA256        string  `json:"evidenceSha256"`
	TransformRevision     string  `json:"transformRevision"`
	NamespaceRemoved      *bool   `json:"namespaceRemoved,omitempty"`
	NamespaceIntentSHA256 *string `json:"namespaceIntentSha256,omitempty"`
}

// Namespace permission never implies physical-residency accounting credit.
type retiredOutputRecoveryPolicy struct {
	PhysicallyRemoved bool
	NamespaceRemoved  bool
}

// This is an explicit caller-provided snapshot of the PostgreSQL authority,
// outside the immutable output directory. It is never inferred from missing
// files and never discovered automatically as an adjacent sidecar.
func readRetirementRecovery(authorityPath string, rawManifest []byte, manifest Manifest) (map[string]retiredOutputRecoveryPolicy, error) {
	if authorityPath == "" {
		return nil, nil
	}
	info, err := os.Lstat(authorityPath)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > 65536 {
		return nil, fmt.Errorf("invalid retirement authority file")
	}
	raw, err := readManifest(authorityPath)
	if err != nil {
		return nil, err
	}
	if len(raw) > 65536 {
		return nil, fmt.Errorf("retirement authority exceeds size bound")
	}
	if err := rejectDuplicateJSONKeys(raw); err != nil {
		return nil, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var authority derivedRetirementRecovery
	if err := decoder.Decode(&authority); err != nil {
		return nil, err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return nil, fmt.Errorf("trailing retirement authority")
	}
	if err := validateRetirementNamespaceJSON(raw, authority.Version); err != nil {
		return nil, err
	}
	return validateRetirementRecovery(authority, rawManifest, manifest)
}

// Presence is checked separately from Go zero values: v1 must reject even
// namespaceRemoved:false or namespaceIntentSha256:null, while v2 requires both.
func validateRetirementNamespaceJSON(raw []byte, version int) error {
	var fields struct {
		Outputs []map[string]json.RawMessage `json:"outputs"`
	}
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	for _, item := range fields.Outputs {
		for key := range item {
			if version == 2 && strings.EqualFold(key, "removed") && key != "removed" {
				return fmt.Errorf("version two requires exact removed key")
			}
			if strings.EqualFold(key, "namespaceRemoved") || strings.EqualFold(key, "namespaceIntentSha256") {
				if version == 1 || (key != "namespaceRemoved" && key != "namespaceIntentSha256") {
					return fmt.Errorf("namespace fields require exact version-two keys")
				}
			}
		}
		if version == 2 {
			physical, present := item["removed"]
			physicalValue := string(bytes.TrimSpace(physical))
			if !present || (physicalValue != "true" && physicalValue != "false") {
				return fmt.Errorf("version two requires removed boolean")
			}
			removed, present := item["namespaceRemoved"]
			value := string(bytes.TrimSpace(removed))
			if !present || (value != "true" && value != "false") {
				return fmt.Errorf("version two requires namespaceRemoved boolean")
			}
			intent, present := item["namespaceIntentSha256"]
			if !present || (value == "false" && string(bytes.TrimSpace(intent)) != "null") {
				return fmt.Errorf("version two requires explicit namespace intent or null")
			}
		}
	}
	return nil
}

func validateRetirementRecovery(authority derivedRetirementRecovery, rawManifest []byte, manifest Manifest) (map[string]retiredOutputRecoveryPolicy, error) {
	hash := sha256.Sum256(rawManifest)
	if (authority.Version != 1 && authority.Version != 2) || !regexp.MustCompile("^[0-9a-f-]{36}$").MatchString(authority.BatchID) ||
		authority.NetworkID != manifest.Network.NetworkIDSHA256 ||
		authority.Start != manifest.Range.StartLedger || authority.End != manifest.Range.EndLedger ||
		authority.ManifestSHA256 != hex.EncodeToString(hash[:]) ||
		len(authority.Outputs) < 1 || len(authority.Outputs) > 3 {
		return nil, fmt.Errorf("retirement authority does not bind this manifest")
	}
	canonicalFound := false
	for _, descriptor := range manifest.Outputs {
		if descriptor.Dataset == "ledger-close-meta" && descriptor.Representation == "lossless-replay" &&
			descriptor.SHA256 == authority.CanonicalSHA256 {
			canonicalFound = true
		}
	}
	if !canonicalFound {
		return nil, fmt.Errorf("retirement authority does not bind canonical replay")
	}
	retired := make(map[string]retiredOutputRecoveryPolicy, len(authority.Outputs))
	for _, item := range authority.Outputs {
		policy := retiredOutputRecoveryPolicy{PhysicallyRemoved: item.Removed}
		if authority.Version == 1 {
			if item.NamespaceRemoved != nil || item.NamespaceIntentSHA256 != nil {
				return nil, fmt.Errorf("version one cannot contain namespace state")
			}
		} else {
			if item.NamespaceRemoved == nil {
				return nil, fmt.Errorf("version two requires namespaceRemoved boolean")
			}
			policy.NamespaceRemoved = *item.NamespaceRemoved
			if policy.NamespaceRemoved {
				if item.NamespaceIntentSHA256 == nil {
					return nil, fmt.Errorf("namespace removal requires durable intent digest")
				}
				if err := validateSHA256(*item.NamespaceIntentSHA256); err != nil {
					return nil, fmt.Errorf("namespace intent: %w", err)
				}
			} else if item.NamespaceIntentSHA256 != nil {
				return nil, fmt.Errorf("namespace intent must be null without namespace removal")
			}
		}
		switch item.Dataset {
		case "transactions", "transaction-results", "operations":
		default:
			return nil, fmt.Errorf("dataset cannot be retired")
		}
		if _, duplicate := retired[item.Dataset]; duplicate {
			return nil, fmt.Errorf("duplicate retired output")
		}
		if err := validateSHA256(item.EvidenceSHA256); err != nil {
			return nil, err
		}
		if !regexp.MustCompile("^[0-9a-f]{40}$").MatchString(item.TransformRevision) {
			return nil, fmt.Errorf("retirement requires pinned transform revision")
		}
		matched := false
		for _, descriptor := range manifest.Outputs {
			if descriptor.Dataset == item.Dataset && descriptor.Representation == "typed-projection" &&
				descriptor.SHA256 == item.SHA256 && descriptor.StorageKey == item.StorageKey &&
				strconv.FormatInt(descriptor.ByteCount, 10) == item.Bytes &&
				strconv.FormatUint(descriptor.RecordCount, 10) == item.Rows {
				matched = true
			}
		}
		if !matched {
			return nil, fmt.Errorf("retirement does not bind original %s descriptor", item.Dataset)
		}
		retired[item.Dataset] = policy
	}
	return retired, nil
}
