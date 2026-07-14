package app

import (
	"flag"
	"fmt"
	"io"
	"math"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"
)

const (
	defaultMaxCompressedBytes    = int64(256 << 20)
	defaultMaxUncompressedBytes  = int64(512 << 20)
	defaultMaxDecodedMemoryBytes = int64(512 << 20)
	defaultMaxOutputBytes        = int64(8 << 30)
	defaultMaxLedgers            = uint64(1024)
	defaultMaxRows               = uint64(10_000_000)
	hardMaxShardLedgers          = uint64(1024)
	hardMaxInputFiles            = 1024
	maxObjectKeyBytes            = 1024
)

var networkNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)
var objectKeyPattern = regexp.MustCompile(`^[A-Za-z0-9._/-]+$`)

type Source struct {
	Path      string
	ObjectKey string
}

type Config struct {
	Sources               []Source
	TypedOutputRoot       string
	OutputPath            string
	NetworkName           string
	NetworkPassphrase     string
	StartLedger           uint32
	EndLedger             uint32
	MaxCompressedBytes    int64
	MaxUncompressedBytes  int64
	MaxDecodedMemoryBytes int64
	MaxOutputBytes        int64
	MaxLedgers            uint64
	MaxRows               uint64
}

type repeatedStrings []string

func (values *repeatedStrings) String() string {
	return strings.Join(*values, ",")
}

func (values *repeatedStrings) Set(value string) error {
	*values = append(*values, value)
	return nil
}

func ParseConfig(args []string, stderr io.Writer) (Config, error) {
	flags := flag.NewFlagSet("full-history-etl", flag.ContinueOnError)
	flags.SetOutput(stderr)
	var config Config
	var inputPaths, objectKeys repeatedStrings
	var start, end uint64
	flags.Var(&inputPaths, "input", "ordered local SEP-54 .xdr.zstd file; repeat for each source object")
	flags.Var(&objectKeys, "input-object-key", "ordered SEP-54 source object key; repeat once per input")
	flags.StringVar(&config.TypedOutputRoot, "typed-output-root", "", "root used to resolve published storage keys")
	flags.StringVar(&config.OutputPath, "output", "", "new output directory to publish atomically")
	flags.StringVar(&config.NetworkName, "network", "", "stable network label")
	flags.StringVar(&config.NetworkPassphrase, "network-passphrase", "", "Stellar network passphrase")
	flags.Uint64Var(&start, "start-ledger", 0, "expected inclusive start ledger")
	flags.Uint64Var(&end, "end-ledger", 0, "expected inclusive end ledger")
	flags.Int64Var(&config.MaxCompressedBytes, "max-compressed-bytes", defaultMaxCompressedBytes, "aggregate compressed input byte limit")
	flags.Int64Var(&config.MaxUncompressedBytes, "max-uncompressed-bytes", defaultMaxUncompressedBytes, "aggregate uncompressed XDR byte limit")
	flags.Int64Var(&config.MaxDecodedMemoryBytes, "max-decoded-memory-bytes", defaultMaxDecodedMemoryBytes, "per-ledger XDR allocation limit")
	flags.Int64Var(&config.MaxOutputBytes, "max-output-bytes", defaultMaxOutputBytes, "aggregate Parquet byte limit")
	flags.Uint64Var(&config.MaxLedgers, "max-ledgers", defaultMaxLedgers, "ledger count limit")
	flags.Uint64Var(&config.MaxRows, "max-rows", defaultMaxRows, "aggregate output row limit")
	if err := flags.Parse(args); err != nil {
		return Config{}, err
	}
	if flags.NArg() != 0 {
		return Config{}, fmt.Errorf("unexpected positional arguments: %s", strings.Join(flags.Args(), " "))
	}
	if len(inputPaths) != len(objectKeys) {
		return Config{}, fmt.Errorf("got %d inputs and %d input object keys", len(inputPaths), len(objectKeys))
	}
	config.Sources = make([]Source, len(inputPaths))
	for index := range inputPaths {
		config.Sources[index] = Source{Path: inputPaths[index], ObjectKey: objectKeys[index]}
	}
	if start > math.MaxUint32 || end > math.MaxUint32 {
		return Config{}, fmt.Errorf("ledger range must fit uint32")
	}
	config.StartLedger, config.EndLedger = uint32(start), uint32(end)
	if err := config.Validate(); err != nil {
		return Config{}, err
	}
	return config, nil
}

func (c Config) Validate() error {
	if len(c.Sources) == 0 {
		return fmt.Errorf("at least one input and input object key are required")
	}
	if len(c.Sources) > hardMaxInputFiles {
		return fmt.Errorf("input count %d exceeds hard limit %d", len(c.Sources), hardMaxInputFiles)
	}
	seenObjectKeys := make(map[string]struct{}, len(c.Sources))
	for index, source := range c.Sources {
		if source.Path == "" {
			return fmt.Errorf("input %d path is required", index)
		}
		if err := validateObjectKey(source.ObjectKey); err != nil {
			return fmt.Errorf("input %d object key: %w", index, err)
		}
		if _, duplicate := seenObjectKeys[source.ObjectKey]; duplicate {
			return fmt.Errorf("duplicate input object key %q", source.ObjectKey)
		}
		seenObjectKeys[source.ObjectKey] = struct{}{}
	}
	if c.OutputPath == "" {
		return fmt.Errorf("output path is required")
	}
	if c.TypedOutputRoot == "" {
		return fmt.Errorf("typed output root is required")
	}
	cleanOutput := filepath.Clean(c.OutputPath)
	if cleanOutput == "." || cleanOutput == string(filepath.Separator) {
		return fmt.Errorf("output must name a new leaf directory")
	}
	if _, _, err := resolveOutputPaths(c.TypedOutputRoot, c.OutputPath); err != nil {
		return err
	}
	if c.StartLedger == 0 || c.EndLedger < c.StartLedger {
		return fmt.Errorf("invalid expected ledger range [%d,%d]", c.StartLedger, c.EndLedger)
	}
	if !networkNamePattern.MatchString(c.NetworkName) {
		return fmt.Errorf("network must match %s", networkNamePattern.String())
	}
	if strings.TrimSpace(c.NetworkPassphrase) == "" {
		return fmt.Errorf("network passphrase is required")
	}
	if c.MaxCompressedBytes <= 0 || c.MaxCompressedBytes == math.MaxInt64 {
		return fmt.Errorf("compressed byte limit must be positive and below MaxInt64")
	}
	if c.MaxUncompressedBytes <= 0 || c.MaxUncompressedBytes == math.MaxInt64 {
		return fmt.Errorf("uncompressed byte limit must be positive and below MaxInt64")
	}
	if c.MaxDecodedMemoryBytes <= 0 || c.MaxOutputBytes <= 0 || c.MaxLedgers == 0 || c.MaxRows == 0 {
		return fmt.Errorf("decoded memory, output, ledger, and row limits must be positive")
	}
	if c.MaxLedgers > hardMaxShardLedgers {
		return fmt.Errorf("ledger limit %d exceeds hard shard limit %d", c.MaxLedgers, hardMaxShardLedgers)
	}
	count := uint64(c.EndLedger) - uint64(c.StartLedger) + 1
	if count > hardMaxShardLedgers {
		return fmt.Errorf("expected ledger count %d exceeds hard shard limit %d", count, hardMaxShardLedgers)
	}
	if count > c.MaxLedgers {
		return fmt.Errorf("expected ledger count %d exceeds limit %d", count, c.MaxLedgers)
	}
	return nil
}

func validateObjectKey(objectKey string) error {
	if objectKey == "" {
		return fmt.Errorf("is required")
	}
	if len(objectKey) > maxObjectKeyBytes {
		return fmt.Errorf("is %d bytes, maximum is %d", len(objectKey), maxObjectKeyBytes)
	}
	if !utf8.ValidString(objectKey) || strings.IndexByte(objectKey, 0) >= 0 {
		return fmt.Errorf("must be valid UTF-8 without NUL bytes")
	}
	if !objectKeyPattern.MatchString(objectKey) || strings.HasPrefix(objectKey, "/") {
		return fmt.Errorf("must be a safe relative archive object key")
	}
	for _, segment := range strings.Split(objectKey, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return fmt.Errorf("contains an unsafe path segment")
		}
	}
	return nil
}

func resolveOutputPaths(root, output string) (rootPath, outputPath string, err error) {
	rootPath, err = filepath.Abs(root)
	if err != nil {
		return "", "", fmt.Errorf("resolve typed output root: %w", err)
	}
	outputPath, err = filepath.Abs(output)
	if err != nil {
		return "", "", fmt.Errorf("resolve output path: %w", err)
	}
	if rootPath == string(filepath.Separator) {
		return "", "", fmt.Errorf("typed output root must not be the filesystem root")
	}
	relative, err := filepath.Rel(rootPath, outputPath)
	if err != nil {
		return "", "", fmt.Errorf("resolve output relative to typed output root: %w", err)
	}
	if relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		return "", "", fmt.Errorf("output must be a strict child of typed output root")
	}
	return rootPath, outputPath, nil
}
