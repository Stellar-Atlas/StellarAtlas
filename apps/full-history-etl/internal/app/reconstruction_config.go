package app

import (
	"fmt"
	"io"
	"path/filepath"
	"regexp"
	"strings"
)

const reconstructionSourceSHA256Flag = "--expected-source-sha256"

var reconstructionSourceSHA256Pattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

// TransactionReconstructionConfig binds one local canonical source to offline
// reconstruction. Normal ingestion configuration and its finite limits remain unchanged.
type TransactionReconstructionConfig struct {
	Config               Config
	ExpectedSourceSHA256 string
}

func ParseTransactionReconstructionConfig(args []string, stderr io.Writer) (TransactionReconstructionConfig, error) {
	var expectedSHA256 string
	seen := false
	remaining := make([]string, 0, len(args))
	for index := 0; index < len(args); index++ {
		argument := args[index]
		if argument == "--" {
			remaining = append(remaining, args[index:]...)
			break
		}
		if argument != reconstructionSourceSHA256Flag &&
			!strings.HasPrefix(argument, reconstructionSourceSHA256Flag+"=") {
			remaining = append(remaining, argument)
			continue
		}
		if seen {
			return TransactionReconstructionConfig{}, fmt.Errorf("%s must be supplied exactly once", reconstructionSourceSHA256Flag)
		}
		seen = true
		if argument == reconstructionSourceSHA256Flag {
			if index+1 >= len(args) {
				return TransactionReconstructionConfig{}, fmt.Errorf("%s requires a digest", reconstructionSourceSHA256Flag)
			}
			index++
			expectedSHA256 = args[index]
		} else {
			expectedSHA256 = strings.TrimPrefix(argument, reconstructionSourceSHA256Flag+"=")
		}
	}
	if !seen {
		return TransactionReconstructionConfig{}, fmt.Errorf("%s is required", reconstructionSourceSHA256Flag)
	}
	if !reconstructionSourceSHA256Pattern.MatchString(expectedSHA256) {
		return TransactionReconstructionConfig{}, fmt.Errorf("%s must contain 64 lowercase hexadecimal characters", reconstructionSourceSHA256Flag)
	}
	config, err := ParseConfig(remaining, stderr)
	if err != nil {
		return TransactionReconstructionConfig{}, err
	}
	reconstruction := TransactionReconstructionConfig{Config: config, ExpectedSourceSHA256: expectedSHA256}
	if err := reconstruction.Validate(); err != nil {
		return TransactionReconstructionConfig{}, err
	}
	return reconstruction, nil
}

func (c TransactionReconstructionConfig) Validate() error {
	if !reconstructionSourceSHA256Pattern.MatchString(c.ExpectedSourceSHA256) {
		return fmt.Errorf("%s must contain 64 lowercase hexadecimal characters", reconstructionSourceSHA256Flag)
	}
	if len(c.Config.Sources) != 1 {
		return fmt.Errorf("transaction reconstruction requires exactly one local canonical input")
	}
	input := c.Config.Sources[0].Path
	if !filepath.IsAbs(input) || strings.Contains(input, "://") {
		return fmt.Errorf("transaction reconstruction input must be an absolute local file path")
	}
	if c.Config.RetirementRecoveryPath != "" || c.Config.PublicationStagingRoot != "" ||
		c.Config.CurrentBulkCommitGuard || c.Config.CompactLedgerEntryChanges {
		return fmt.Errorf("transaction reconstruction cannot use retirement recovery, publication staging, current bulk commit guard, or compact ledger entries")
	}
	return c.Config.Validate()
}
