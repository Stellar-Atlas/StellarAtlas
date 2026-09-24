package clickhouse

import (
	"context"
	"errors"
	"fmt"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/schema"
)

// RequestError distinguishes warehouse requests from source-file/decoder errors.
// It preserves the underlying error for cancellation and caller diagnostics.
type RequestError struct{ Err error }

func (e *RequestError) Error() string { return e.Err.Error() }
func (e *RequestError) Unwrap() error { return e.Err }

func IsWarehouseFailure(err error) bool {
	var failure *RequestError
	return errors.As(err, &failure) && !errors.Is(err, context.Canceled)
}

// CheckReady resolves each required table without scanning dataset rows.
// A ping or system.tables lookup can succeed while an asynchronous table load
// has failed. DESCRIBE must resolve that table and propagates its load failure.
func (c *Client) CheckReady(ctx context.Context) error {
	tables := []string{"_ingestion_batches"}
	for _, dataset := range schema.Datasets() {
		tables = append(tables, dataset.Name)
	}
	for _, table := range tables {
		query := "DESCRIBE TABLE " + quoted(c.database) + "." + quoted(table) + " FORMAT Null"
		if _, err := c.execute(ctx, query, nil, nil); err != nil {
			return fmt.Errorf("warehouse table %s.%s unavailable: %w", c.database, table, err)
		}
	}
	return nil
}
