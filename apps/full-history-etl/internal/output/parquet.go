package output

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/model"
	"github.com/xitongsys/parquet-go/parquet"
	"github.com/xitongsys/parquet-go/writer"
)

const (
	rowGroupBytes                 = 8 << 20
	pageBytes                     = 64 << 10
	ParquetMediaType              = "application/vnd.apache.parquet"
	LosslessReplayRepresentation  = "lossless-replay"
	TypedProjectionRepresentation = "typed-projection"
)

type Descriptor struct {
	Dataset        string `json:"dataset"`
	MediaType      string `json:"mediaType"`
	Representation string `json:"representation"`
	SchemaVersion  string `json:"schemaVersion"`
	RecordCount    uint64 `json:"recordCount"`
	ByteCount      int64  `json:"byteCount"`
	SHA256         string `json:"sha256"`
	StorageKey     string `json:"storageKey"`
}

type Specification struct {
	Dataset        string
	Filename       string
	MediaType      string
	Representation string
	SchemaVersion  string
}

var specifications = [...]Specification{
	{Dataset: "ledgers", Filename: "ledgers.parquet", MediaType: ParquetMediaType, Representation: TypedProjectionRepresentation, SchemaVersion: "stellar-atlas.full-history.ledgers.v2"},
	{Dataset: "transactions", Filename: "transactions.parquet", MediaType: ParquetMediaType, Representation: TypedProjectionRepresentation, SchemaVersion: "stellar-atlas.full-history.transactions.v2"},
	{Dataset: "operations", Filename: "operations.parquet", MediaType: ParquetMediaType, Representation: TypedProjectionRepresentation, SchemaVersion: "stellar-atlas.full-history.operations.v2"},
	{Dataset: "transaction-results", Filename: "transaction-results.parquet", MediaType: ParquetMediaType, Representation: TypedProjectionRepresentation, SchemaVersion: "stellar-atlas.full-history.transaction-results.v2"},
	{Dataset: "transaction-meta", Filename: "transaction-meta.parquet", MediaType: ParquetMediaType, Representation: TypedProjectionRepresentation, SchemaVersion: "stellar-atlas.full-history.transaction-meta.v2"},
	{Dataset: "contract-events", Filename: "contract-events.parquet", MediaType: ParquetMediaType, Representation: TypedProjectionRepresentation, SchemaVersion: "stellar-atlas.full-history.contract-events.v2"},
	{Dataset: "ledger-entry-changes", Filename: "ledger-entry-changes.parquet", MediaType: ParquetMediaType, Representation: TypedProjectionRepresentation, SchemaVersion: "stellar-atlas.full-history.ledger-entry-changes.v2"},
}

func Specifications() []Specification {
	result := make([]Specification, 0, len(specifications)+1)
	result = append(result, Specification{
		Dataset: ledgerCloseMetaDataset, Filename: ledgerCloseMetaFilename,
		MediaType: LedgerCloseMetaMediaType, Representation: LosslessReplayRepresentation, SchemaVersion: ledgerCloseMetaSchemaVersion,
	})
	result = append(result, specifications[:]...)
	return result
}

type Collection struct {
	LedgerCloseMeta    *LedgerCloseMetaSink
	Ledgers            *Sink[model.Ledger]
	Transactions       *Sink[model.Transaction]
	Operations         *Sink[model.Operation]
	TransactionResults *Sink[model.TransactionResult]
	TransactionMeta    *Sink[model.TransactionMeta]
	ContractEvents     *Sink[model.ContractEvent]
	LedgerEntryChanges *Sink[model.LedgerEntryChange]

	sinks []lifecycle
}

type lifecycle interface {
	finish() error
	abort()
	descriptor() (Descriptor, error)
}

type Sink[T any] struct {
	dataset        string
	filename       string
	schemaVersion  string
	mediaType      string
	representation string
	path           string
	file           *os.File
	writer         *writer.ParquetWriter
	rows           uint64
	finished       bool
}

type byteBudget struct {
	mu   sync.Mutex
	max  int64
	used int64
}

type budgetWriter struct {
	file   *os.File
	budget *byteBudget
}

func OpenCollection(directory string, maxBytes int64, startLedger, endLedger uint32) (*Collection, error) {
	if maxBytes <= 0 {
		return nil, fmt.Errorf("output byte limit must be positive")
	}
	budget := &byteBudget{max: maxBytes}
	collection := &Collection{}
	var err error
	defer func() {
		if err != nil {
			collection.Abort()
		}
	}()
	if collection.LedgerCloseMeta, err = newLedgerCloseMetaSink(directory, budget, startLedger, endLedger); err != nil {
		return nil, err
	}
	collection.sinks = append(collection.sinks, collection.LedgerCloseMeta)

	if collection.Ledgers, err = newSink[model.Ledger](directory, budget, specifications[0]); err != nil {
		return nil, err
	}
	collection.sinks = append(collection.sinks, collection.Ledgers)
	if collection.Transactions, err = newSink[model.Transaction](directory, budget, specifications[1]); err != nil {
		return nil, err
	}
	collection.sinks = append(collection.sinks, collection.Transactions)
	if collection.Operations, err = newSink[model.Operation](directory, budget, specifications[2]); err != nil {
		return nil, err
	}
	collection.sinks = append(collection.sinks, collection.Operations)
	if collection.TransactionResults, err = newSink[model.TransactionResult](directory, budget, specifications[3]); err != nil {
		return nil, err
	}
	collection.sinks = append(collection.sinks, collection.TransactionResults)
	if collection.TransactionMeta, err = newSink[model.TransactionMeta](directory, budget, specifications[4]); err != nil {
		return nil, err
	}
	collection.sinks = append(collection.sinks, collection.TransactionMeta)
	if collection.ContractEvents, err = newSink[model.ContractEvent](directory, budget, specifications[5]); err != nil {
		return nil, err
	}
	collection.sinks = append(collection.sinks, collection.ContractEvents)
	if collection.LedgerEntryChanges, err = newSink[model.LedgerEntryChange](directory, budget, specifications[6]); err != nil {
		return nil, err
	}
	collection.sinks = append(collection.sinks, collection.LedgerEntryChanges)
	return collection, nil
}

func newSink[T any](directory string, budget *byteBudget, specification Specification) (*Sink[T], error) {
	path := filepath.Join(directory, specification.Filename)
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, fmt.Errorf("create %s output: %w", specification.Dataset, err)
	}
	parquetWriter, err := writer.NewParquetWriterFromWriter(&budgetWriter{file: file, budget: budget}, new(T), 1)
	if err != nil {
		file.Close()
		return nil, fmt.Errorf("create %s parquet writer: %w", specification.Dataset, err)
	}
	parquetWriter.RowGroupSize = rowGroupBytes
	parquetWriter.PageSize = pageBytes
	parquetWriter.CompressionType = parquet.CompressionCodec_ZSTD
	return &Sink[T]{
		dataset:        specification.Dataset,
		filename:       specification.Filename,
		schemaVersion:  specification.SchemaVersion,
		mediaType:      specification.MediaType,
		representation: specification.Representation,
		path:           path,
		file:           file,
		writer:         parquetWriter,
	}, nil
}

func (s *Sink[T]) Write(row T) error {
	if s == nil {
		return fmt.Errorf("output sink is nil")
	}
	if s.finished {
		return fmt.Errorf("%s output is not writable", s.dataset)
	}
	if err := s.writer.Write(row); err != nil {
		return fmt.Errorf("write %s row: %w", s.dataset, err)
	}
	s.rows++
	return nil
}

func (c *Collection) Finish() ([]Descriptor, error) {
	var finishErrors []error
	for _, sink := range c.sinks {
		if err := sink.finish(); err != nil {
			finishErrors = append(finishErrors, err)
		}
	}
	if err := errors.Join(finishErrors...); err != nil {
		return nil, err
	}
	descriptors := make([]Descriptor, 0, len(c.sinks))
	for _, sink := range c.sinks {
		descriptor, err := sink.descriptor()
		if err != nil {
			return nil, err
		}
		descriptors = append(descriptors, descriptor)
	}
	return descriptors, nil
}

func (c *Collection) Abort() {
	if c == nil {
		return
	}
	for _, sink := range c.sinks {
		sink.abort()
	}
}

func (s *Sink[T]) finish() error {
	if s.finished {
		return nil
	}
	s.finished = true
	writeErr := s.writer.WriteStop()
	syncErr := s.file.Sync()
	closeErr := s.file.Close()
	if err := errors.Join(writeErr, syncErr, closeErr); err != nil {
		return fmt.Errorf("finish %s output: %w", s.dataset, err)
	}
	return nil
}

func (s *Sink[T]) abort() {
	if s == nil || s.finished {
		return
	}
	s.finished = true
	_ = s.file.Close()
}

func (s *Sink[T]) descriptor() (Descriptor, error) {
	if !s.finished {
		return Descriptor{}, fmt.Errorf("%s output is not finished", s.dataset)
	}
	hash, size, err := hashFile(s.path)
	if err != nil {
		return Descriptor{}, fmt.Errorf("hash %s output: %w", s.dataset, err)
	}
	return Descriptor{
		Dataset:        s.dataset,
		MediaType:      s.mediaType,
		Representation: s.representation,
		SchemaVersion:  s.schemaVersion,
		RecordCount:    s.rows,
		ByteCount:      size,
		SHA256:         hash,
		StorageKey:     s.filename,
	}, nil
}

func (w *budgetWriter) Write(data []byte) (int, error) {
	w.budget.mu.Lock()
	defer w.budget.mu.Unlock()
	if int64(len(data)) > w.budget.max-w.budget.used {
		return 0, fmt.Errorf("aggregate parquet output exceeds byte limit %d", w.budget.max)
	}
	n, err := w.file.Write(data)
	w.budget.used += int64(n)
	return n, err
}

func hashFile(path string) (string, int64, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer file.Close()
	hash := sha256.New()
	size, err := io.Copy(hash, file)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(hash.Sum(nil)), size, nil
}
