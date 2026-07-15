package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/output"
	"github.com/stellar/go-stellar-sdk/network"
	"github.com/stellar/go-stellar-sdk/xdr"
)

const (
	manifestFilename = "manifest.json"
	manifestVersion  = "stellar-atlas.full-history-etl.manifest.v7"
	inputMediaType   = "application/x-stellar-ledger-close-meta-batch+xdr+zstd"
	maxManifestBytes = 4 << 20
)

type Manifest struct {
	ManifestVersion string              `json:"manifestVersion"`
	CreatedAt       string              `json:"createdAt"`
	Network         ManifestNetwork     `json:"network"`
	Range           ManifestRange       `json:"range"`
	InputMediaType  string              `json:"inputMediaType"`
	SourceObjects   []SourceEvidence    `json:"sourceObjects"`
	Format          ManifestFormat      `json:"format"`
	Limits          ManifestLimits      `json:"limits"`
	Outputs         []output.Descriptor `json:"outputs"`
	Unsupported     []string            `json:"unsupportedDatasets"`
}

type ManifestNetwork struct {
	Name            string `json:"name"`
	NetworkIDSHA256 string `json:"networkIdSha256"`
}

type ManifestRange struct {
	StartLedger uint32 `json:"startLedger"`
	EndLedger   uint32 `json:"endLedger"`
	LedgerCount uint64 `json:"ledgerCount"`
}

type SourceEvidence struct {
	ObjectKey               string `json:"objectKey"`
	StartLedger             uint32 `json:"startLedger"`
	EndLedger               uint32 `json:"endLedger"`
	LedgerCount             uint64 `json:"ledgerCount"`
	CompressedByteCount     int64  `json:"compressedByteCount"`
	CompressedSHA256        string `json:"compressedSha256"`
	FirstPreviousLedgerHash string `json:"firstPreviousLedgerHash"`
	LastLedgerHash          string `json:"lastLedgerHash"`
	XDRByteCount            int64  `json:"xdrByteCount"`
	XDRSHA256               string `json:"xdrSha256"`
}

type ManifestFormat struct {
	Name                             string   `json:"name"`
	ParquetCompression               string   `json:"parquetCompression"`
	ParquetWriter                    string   `json:"parquetWriter"`
	CanonicalLedgerCloseMetaEncoding string   `json:"canonicalLedgerCloseMetaEncoding"`
	PartitionColumns                 []string `json:"partitionColumns"`
	StellarSDK                       string   `json:"stellarSdk"`
	StellarXDRCommit                 string   `json:"stellarXdrCommit"`
}

type ManifestLimits struct {
	MaxCompressedBytes    int64  `json:"maxCompressedBytes"`
	MaxUncompressedBytes  int64  `json:"maxUncompressedBytes"`
	MaxDecodedMemoryBytes int64  `json:"maxDecodedMemoryBytes"`
	MaxOutputBytes        int64  `json:"maxOutputBytes"`
	MaxLedgers            uint64 `json:"maxLedgers"`
	MaxRows               uint64 `json:"maxRows"`
}

type ProcessingReceipt struct {
	ManifestSHA256     string              `json:"manifestSha256"`
	ManifestStorageKey string              `json:"manifestStorageKey"`
	Network            ManifestNetwork     `json:"network"`
	Range              ManifestRange       `json:"range"`
	InputMediaType     string              `json:"inputMediaType"`
	SourceObjects      []SourceEvidence    `json:"sourceObjects"`
	Outputs            []output.Descriptor `json:"outputs"`
}

func newManifest(config Config, evidence ShardEvidence, descriptors []output.Descriptor) Manifest {
	networkID := network.ID(config.NetworkPassphrase)
	return Manifest{
		ManifestVersion: manifestVersion,
		CreatedAt:       time.Now().UTC().Format(time.RFC3339Nano),
		Network: ManifestNetwork{
			Name:            config.NetworkName,
			NetworkIDSHA256: hex.EncodeToString(networkID[:]),
		},
		Range:          evidence.Range,
		InputMediaType: inputMediaType,
		SourceObjects:  evidence.SourceObjects,
		Format: ManifestFormat{
			Name:                             "stellar-atlas-full-history-shard",
			ParquetCompression:               "zstd",
			ParquetWriter:                    "github.com/xitongsys/parquet-go@v1.6.2",
			CanonicalLedgerCloseMetaEncoding: "xdr+zstd",
			PartitionColumns:                 []string{"ledger_sequence"},
			StellarSDK:                       "github.com/stellar/go-stellar-sdk@v0.6.0",
			StellarXDRCommit:                 strings.TrimSpace(xdr.CommitHash),
		},
		Limits: ManifestLimits{
			MaxCompressedBytes:    config.MaxCompressedBytes,
			MaxUncompressedBytes:  config.MaxUncompressedBytes,
			MaxDecodedMemoryBytes: config.MaxDecodedMemoryBytes,
			MaxOutputBytes:        config.MaxOutputBytes,
			MaxLedgers:            config.MaxLedgers,
			MaxRows:               config.MaxRows,
		},
		Outputs: descriptors,
		Unsupported: []string{
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
		},
	}
}

func newReceipt(manifest Manifest, manifestSHA256, manifestStorageKey string) ProcessingReceipt {
	return ProcessingReceipt{
		ManifestSHA256:     manifestSHA256,
		ManifestStorageKey: manifestStorageKey,
		Network:            manifest.Network,
		Range:              manifest.Range,
		InputMediaType:     manifest.InputMediaType,
		SourceObjects:      manifest.SourceObjects,
		Outputs:            manifest.Outputs,
	}
}

func writeManifest(directory string, manifest Manifest) error {
	encoded, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return fmt.Errorf("encode manifest: %w", err)
	}
	encoded = append(encoded, '\n')
	if len(encoded) > maxManifestBytes {
		return fmt.Errorf("manifest size %d exceeds limit %d", len(encoded), maxManifestBytes)
	}
	temporary := filepath.Join(directory, ".manifest.json.tmp")
	final := filepath.Join(directory, manifestFilename)
	file, err := os.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("create manifest temporary file: %w", err)
	}
	writeErr := func() error {
		if _, err := file.Write(encoded); err != nil {
			return err
		}
		return file.Sync()
	}()
	closeErr := file.Close()
	if writeErr != nil {
		return fmt.Errorf("write manifest: %w", writeErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close manifest: %w", closeErr)
	}
	if err := os.Rename(temporary, final); err != nil {
		return fmt.Errorf("finalize manifest: %w", err)
	}
	return nil
}

func hashFile(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
