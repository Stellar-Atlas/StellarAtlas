package output

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/klauspost/compress/zstd"
	"github.com/stellar/go-stellar-sdk/xdr"
)

const (
	ledgerCloseMetaDataset       = "ledger-close-meta"
	ledgerCloseMetaFilename      = "ledger-close-meta.xdr.zst"
	LedgerCloseMetaMediaType     = "application/x-stellar-ledger-close-meta-batch+xdr+zstd"
	ledgerCloseMetaSchemaVersion = "stellar-atlas.full-history.ledger-close-meta-batch.v1"
)

// LedgerCloseMetaSink writes one canonical range-level XDR batch. It is the
// lossless replay source after the downloaded provider objects are discarded.
type LedgerCloseMetaSink struct {
	path         string
	file         *os.File
	encoder      *zstd.Encoder
	expectedEnd  uint32
	expectedRows uint64
	nextSequence uint32
	rows         uint64
	finished     bool
}

func newLedgerCloseMetaSink(directory string, budget *byteBudget, start, end uint32) (*LedgerCloseMetaSink, error) {
	if start == 0 || end < start {
		return nil, fmt.Errorf("invalid canonical LedgerCloseMeta range [%d,%d]", start, end)
	}
	expectedRows := uint64(end) - uint64(start) + 1
	if expectedRows > uint64(^uint32(0)) {
		return nil, fmt.Errorf("canonical LedgerCloseMeta range is too large")
	}
	path := filepath.Join(directory, ledgerCloseMetaFilename)
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, fmt.Errorf("create canonical LedgerCloseMeta output: %w", err)
	}
	encoder, err := zstd.NewWriter(&budgetWriter{file: file, budget: budget}, zstd.WithEncoderConcurrency(1))
	if err != nil {
		file.Close()
		return nil, fmt.Errorf("create canonical LedgerCloseMeta encoder: %w", err)
	}
	sink := &LedgerCloseMetaSink{
		path: path, file: file, encoder: encoder, expectedEnd: end,
		expectedRows: expectedRows, nextSequence: start,
	}
	for _, value := range []xdr.Uint32{xdr.Uint32(start), xdr.Uint32(end), xdr.Uint32(expectedRows)} {
		if _, err := xdr.Marshal(encoder, value); err != nil {
			sink.abort()
			return nil, fmt.Errorf("write canonical LedgerCloseMeta header: %w", err)
		}
	}
	return sink, nil
}

func (s *LedgerCloseMetaSink) Write(meta xdr.LedgerCloseMeta) error {
	if s == nil || s.finished {
		return fmt.Errorf("canonical LedgerCloseMeta output is not writable")
	}
	if meta.LedgerSequence() != s.nextSequence || s.nextSequence > s.expectedEnd {
		return fmt.Errorf("canonical LedgerCloseMeta sequence %d does not match expected %d", meta.LedgerSequence(), s.nextSequence)
	}
	if _, err := xdr.Marshal(s.encoder, meta); err != nil {
		return fmt.Errorf("write canonical LedgerCloseMeta %d: %w", s.nextSequence, err)
	}
	s.rows++
	s.nextSequence++
	return nil
}

func (s *LedgerCloseMetaSink) finish() error {
	if s.finished {
		return nil
	}
	if s.rows != s.expectedRows || s.nextSequence != s.expectedEnd+1 {
		return fmt.Errorf("canonical LedgerCloseMeta output has %d rows, expected %d", s.rows, s.expectedRows)
	}
	s.finished = true
	encodeErr := s.encoder.Close()
	syncErr := s.file.Sync()
	closeErr := s.file.Close()
	if err := errors.Join(encodeErr, syncErr, closeErr); err != nil {
		return fmt.Errorf("finish canonical LedgerCloseMeta output: %w", err)
	}
	return nil
}

func (s *LedgerCloseMetaSink) abort() {
	if s == nil || s.finished {
		return
	}
	s.finished = true
	_ = s.encoder.Close()
	_ = s.file.Close()
}

func (s *LedgerCloseMetaSink) descriptor() (Descriptor, error) {
	if !s.finished {
		return Descriptor{}, fmt.Errorf("canonical LedgerCloseMeta output is not finished")
	}
	hash, size, err := hashFile(s.path)
	if err != nil {
		return Descriptor{}, fmt.Errorf("hash canonical LedgerCloseMeta output: %w", err)
	}
	return Descriptor{
		Dataset: ledgerCloseMetaDataset, MediaType: LedgerCloseMetaMediaType,
		Representation: LosslessReplayRepresentation,
		SchemaVersion:  ledgerCloseMetaSchemaVersion, RecordCount: s.rows,
		ByteCount: size, SHA256: hash, StorageKey: ledgerCloseMetaFilename,
	}, nil
}
