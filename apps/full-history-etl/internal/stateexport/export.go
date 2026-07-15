package stateexport

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strconv"

	"github.com/xitongsys/parquet-go/reader"
	"github.com/xitongsys/parquet-go/schema"
	"github.com/xitongsys/parquet-go/source"
)

const (
	MaxNDJSONLineBytes = 1 << 20
	readBatchRows      = 32
)

func Export(ctx context.Context, config Config, output io.Writer) (recordCount uint64, resultErr error) {
	if err := config.Validate(); err != nil {
		return 0, err
	}
	if ctx == nil {
		return 0, fmt.Errorf("context is required")
	}
	if output == nil {
		return 0, fmt.Errorf("output writer is required")
	}

	files := newParquetFileGroup(config.InputPath)
	input, sourceSHA256, err := files.open(ctx)
	if err != nil {
		return 0, fmt.Errorf("open %s parquet: %w", config.Dataset, err)
	}
	defer func() {
		if closeErr := files.closeAll(); closeErr != nil {
			resultErr = errors.Join(resultErr, closeErr)
		}
	}()

	switch config.Dataset {
	case AccountStateChanges:
		recordCount, resultErr = exportTyped(ctx, input, output, config.Dataset, sourceSHA256, makeAccountValue)
	case Ledgers:
		recordCount, resultErr = exportTyped(ctx, input, output, config.Dataset, sourceSHA256, makeLedgerValue)
	case TrustlineStateChanges:
		recordCount, resultErr = exportTyped(ctx, input, output, config.Dataset, sourceSHA256, makeTrustlineValue)
	default:
		return 0, fmt.Errorf("unsupported dataset %q", config.Dataset)
	}
	if resultErr != nil {
		return recordCount, resultErr
	}
	if err := files.verifyUnchanged(ctx); err != nil {
		return recordCount, fmt.Errorf("verify %s parquet source: %w", config.Dataset, err)
	}
	if err := writeLine(output, complete{
		Type: "complete", Dataset: config.Dataset, RecordCount: strconv.FormatUint(recordCount, 10),
	}); err != nil {
		return recordCount, fmt.Errorf("write completion: %w", err)
	}
	return recordCount, nil
}

func exportTyped[Source, Value any](
	ctx context.Context,
	input source.ParquetFile,
	output io.Writer,
	dataset Dataset,
	sourceSHA256 string,
	convert func(Source) (Value, error),
) (recordCount uint64, resultErr error) {
	if err := validateParquetSchema[Source](input); err != nil {
		return 0, fmt.Errorf("validate %s parquet: %w", dataset, err)
	}
	parquetReader, err := newTypedReader[Source](input)
	if err != nil {
		return 0, fmt.Errorf("create %s parquet reader: %w", dataset, err)
	}
	defer parquetReader.ReadStop()

	rows := parquetReader.GetNumRows()
	if rows < 0 {
		return 0, fmt.Errorf("%s parquet has negative row count %d", dataset, rows)
	}
	if err := ctx.Err(); err != nil {
		return 0, fmt.Errorf("export %s: %w", dataset, err)
	}
	if err := writeLine(output, header{
		Type: "header", Version: Version, Dataset: dataset, SourceSHA256: sourceSHA256,
	}); err != nil {
		return 0, fmt.Errorf("write header: %w", err)
	}
	for remaining := rows; remaining > 0; {
		if err := ctx.Err(); err != nil {
			return recordCount, fmt.Errorf("export %s: %w", dataset, err)
		}
		batchSize := minInt64(remaining, readBatchRows)
		batch := make([]Source, int(batchSize))
		if err := parquetReader.Read(&batch); err != nil {
			return recordCount, fmt.Errorf("read %s parquet row %d: %w", dataset, recordCount, err)
		}
		if len(batch) != int(batchSize) {
			return recordCount, fmt.Errorf(
				"read %s parquet returned %d rows at row %d, expected %d",
				dataset, len(batch), recordCount, batchSize,
			)
		}
		for _, sourceRow := range batch {
			if err := ctx.Err(); err != nil {
				return recordCount, fmt.Errorf("export %s: %w", dataset, err)
			}
			value, err := convert(sourceRow)
			if err != nil {
				return recordCount, fmt.Errorf("convert %s row %d: %w", dataset, recordCount, err)
			}
			if err := writeLine(output, rowEnvelope[Value]{Type: "row", Dataset: dataset, Value: value}); err != nil {
				return recordCount, fmt.Errorf("write %s row %d: %w", dataset, recordCount, err)
			}
			recordCount++
		}
		remaining -= batchSize
	}
	if err := ctx.Err(); err != nil {
		return recordCount, fmt.Errorf("export %s: %w", dataset, err)
	}
	return recordCount, nil
}

func newTypedReader[T any](input source.ParquetFile) (result *reader.ParquetReader, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			result = nil
			err = fmt.Errorf("parquet reader panicked: %v", recovered)
		}
	}()
	return reader.NewParquetReader(input, new(T), 1)
}

func validateParquetSchema[T any](input source.ParquetFile) error {
	footerReader := &reader.ParquetReader{PFile: input}
	if err := footerReader.ReadFooter(); err != nil {
		return err
	}
	want, err := schema.NewSchemaHandlerFromStruct(new(T))
	if err != nil {
		return fmt.Errorf("build expected schema: %w", err)
	}
	got := footerReader.Footer.GetSchema()
	if len(got) != len(want.SchemaElements) {
		return fmt.Errorf("schema has %d elements, expected %d", len(got), len(want.SchemaElements))
	}
	for index := range got {
		expected := *want.SchemaElements[index]
		expected.Name = want.Infos[index].ExName
		if !reflect.DeepEqual(got[index], &expected) {
			return fmt.Errorf("schema element %d (%q) does not match expected %q", index, got[index].GetName(), expected.GetName())
		}
	}
	return nil
}

func writeLine(output io.Writer, value any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("encode NDJSON: %w", err)
	}
	if len(encoded) > MaxNDJSONLineBytes {
		return fmt.Errorf("NDJSON line is %d bytes, maximum is %d", len(encoded), MaxNDJSONLineBytes)
	}
	encoded = append(encoded, '\n')
	for len(encoded) > 0 {
		written, writeErr := output.Write(encoded)
		if written < 0 || written > len(encoded) {
			return fmt.Errorf("writer returned invalid byte count %d", written)
		}
		encoded = encoded[written:]
		if writeErr != nil {
			return writeErr
		}
		if written == 0 {
			return io.ErrShortWrite
		}
	}
	return nil
}

func minInt64(left int64, right int) int64 {
	if left < int64(right) {
		return left
	}
	return int64(right)
}
