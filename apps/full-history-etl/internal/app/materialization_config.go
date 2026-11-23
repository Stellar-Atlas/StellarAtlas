package app

import (
	"flag"
	"fmt"
	"io"
	"path/filepath"
	"time"
)

// MaterializationConfig is supplied by the trusted catalogue adapter, never
// directly from request parameters. It owns only a dedicated disposable cache.
type MaterializationConfig struct {
	CanonicalPath, ManifestPath, ExpectedManifestSHA256, ExpectedSourceSHA256 string
	Dataset, CacheRoot, NetworkPassphrase                                     string
	CacheMaxBytes                                                             uint64
	Limits                                                                    ManifestLimits
	Timeout                                                                   time.Duration
}

func ParseMaterializationConfig(args []string, stderr io.Writer) (MaterializationConfig, error) {
	flags := flag.NewFlagSet("full-history-materialize", flag.ContinueOnError)
	flags.SetOutput(stderr)
	var c MaterializationConfig
	flags.StringVar(&c.CanonicalPath, "canonical", "", "trusted retained canonical source")
	flags.StringVar(&c.ManifestPath, "manifest", "", "trusted original immutable manifest")
	flags.StringVar(&c.ExpectedManifestSHA256, "expected-manifest-sha256", "", "catalogue manifest digest")
	flags.StringVar(&c.ExpectedSourceSHA256, "expected-source-sha256", "", "catalogue canonical output digest")
	flags.StringVar(&c.Dataset, "dataset", "", "one original Parquet projection to open")
	flags.StringVar(&c.CacheRoot, "cache-root", "", "dedicated private disposable cache")
	flags.Uint64Var(&c.CacheMaxBytes, "cache-max-bytes", 0, "maximum cache including reconstruction scratch")
	flags.StringVar(&c.NetworkPassphrase, "network-passphrase", "", "trusted Stellar network passphrase")
	flags.Int64Var(&c.Limits.MaxCompressedBytes, "max-compressed-bytes", defaultMaxCompressedBytes, "canonical input bound")
	flags.Int64Var(&c.Limits.MaxUncompressedBytes, "max-uncompressed-bytes", defaultMaxUncompressedBytes, "decoded input bound")
	flags.Int64Var(&c.Limits.MaxDecodedMemoryBytes, "max-decoded-memory-bytes", defaultMaxDecodedMemoryBytes, "per-ledger allocation bound")
	flags.Int64Var(&c.Limits.MaxOutputBytes, "max-output-bytes", defaultMaxOutputBytes, "reconstructed output bound")
	flags.Uint64Var(&c.Limits.MaxLedgers, "max-ledgers", 64, "ledger bound; larger cohorts require separate resource qualification")
	flags.Uint64Var(&c.Limits.MaxRows, "max-rows", defaultMaxRows, "aggregate row bound")
	flags.DurationVar(&c.Timeout, "timeout", 5*time.Minute, "overall helper deadline including lock wait")
	if err := flags.Parse(args); err != nil {
		return c, err
	}
	if flags.NArg() != 0 {
		return c, fmt.Errorf("unexpected positional arguments")
	}
	return c, c.Validate()
}

func (c MaterializationConfig) Validate() error {
	for _, p := range []string{c.CanonicalPath, c.ManifestPath, c.CacheRoot} {
		if !filepath.IsAbs(p) || filepath.Clean(p) != p || p == string(filepath.Separator) {
			return fmt.Errorf("materialization paths must be absolute canonical non-root paths")
		}
	}
	if pathsOverlap(c.CacheRoot, c.CanonicalPath) || pathsOverlap(c.CacheRoot, c.ManifestPath) {
		return fmt.Errorf("cache must be separate from retained source and manifest")
	}
	if !reconstructionSourceSHA256Pattern.MatchString(c.ExpectedManifestSHA256) ||
		!reconstructionSourceSHA256Pattern.MatchString(c.ExpectedSourceSHA256) || c.NetworkPassphrase == "" {
		return fmt.Errorf("valid catalogue digests and trusted network are required")
	}
	if !materializableDataset(c.Dataset) || c.CacheMaxBytes == 0 || c.Timeout <= 0 {
		return fmt.Errorf("invalid dataset, cache bound or deadline")
	}
	if c.Limits.MaxCompressedBytes <= 0 || c.Limits.MaxUncompressedBytes <= 0 ||
		c.Limits.MaxDecodedMemoryBytes <= 0 || c.Limits.MaxOutputBytes <= 0 ||
		c.Limits.MaxLedgers == 0 || c.Limits.MaxLedgers > hardMaxShardLedgers || c.Limits.MaxRows == 0 {
		return fmt.Errorf("invalid reconstruction resource limits")
	}
	return nil
}

func materializableDataset(dataset string) bool {
	_, err := materializedFilename(dataset)
	return err == nil
}
