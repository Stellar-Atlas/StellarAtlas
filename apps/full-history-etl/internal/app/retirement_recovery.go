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
	Dataset           string `json:"dataset"`
	SHA256            string `json:"outputSha256"`
	Bytes             string `json:"byteCount"`
	Rows              string `json:"recordCount"`
	StorageKey        string `json:"storageKey"`
	Removed           bool   `json:"removed"`
	EvidenceSHA256    string `json:"evidenceSha256"`
	TransformRevision string `json:"transformRevision"`
}

// This is an explicit caller-provided snapshot of the PostgreSQL authority,
// outside the immutable output directory. It is never inferred from missing
// files and never discovered automatically as an adjacent sidecar.
func readRetirementRecovery(authorityPath string, rawManifest []byte, manifest Manifest) (map[string]bool, error) {
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
	return validateRetirementRecovery(authority, rawManifest, manifest)
}

func validateRetirementRecovery(authority derivedRetirementRecovery, rawManifest []byte, manifest Manifest) (map[string]bool, error) {
	hash := sha256.Sum256(rawManifest)
	if authority.Version != 1 || !regexp.MustCompile("^[0-9a-f-]{36}$").MatchString(authority.BatchID) ||
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
	retired := make(map[string]bool, len(authority.Outputs))
	for _, item := range authority.Outputs {
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
		retired[item.Dataset] = item.Removed
	}
	return retired, nil
}
