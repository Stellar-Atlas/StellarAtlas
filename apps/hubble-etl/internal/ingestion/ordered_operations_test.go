package ingestion

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stellar/go-stellar-sdk/xdr"
	"github.com/stellar/stellar-etl/v2/internal/transform"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/clickhouse"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/projector"
)

func operationsRouteFixture(t *testing.T, enabled bool) (*effectsRouteWriter, *forbiddenEffectsTransport) {
	t.Helper()
	transport := &forbiddenEffectsTransport{}
	client, err := clickhouse.New(clickhouse.Config{Endpoint: "http://offline.invalid", Database: "operations_route", SingleCopyOperations: true, HTTPClient: &http.Client{Transport: transport}})
	if err != nil {
		t.Fatal(err)
	}
	w, err := clickhouse.NewBatchWriter(client, clickhouse.BatchIdentity{ID: "0a1b2c3d-4e5f-4678-8910-112233445566", SourceSHA256: strings.Repeat("a", 64), StartLedger: 1, EndLedger: 3}, clickhouse.WriterLimits{TypedOperations: enabled, MaximumRows: 1000, MaximumBytes: 1 << 20})
	if err != nil {
		t.Fatal(err)
	}
	return &effectsRouteWriter{BatchWriter: w}, transport
}

func orderedOperationRow(ledger uint32) transform.OperationOutput {
	return transform.OperationOutput{OperationID: int64(ledger), ClosedAt: time.Unix(1700000000, 0).UTC(), LedgerSequence: ledger, OperationDetailsJSON: map[string]any{"decimal": "9007199254740993.0000001"}}
}

type operationRouteProcessor struct{ emitter projector.Emitter }

func (p operationRouteProcessor) ProcessLedger(ctx context.Context, meta xdr.LedgerCloseMeta) error {
	return p.emitter.Emit(ctx, "history_operations", meta.LedgerSequence(), orderedOperationRow(meta.LedgerSequence()))
}

func TestOrderedOperationsRouteAndBudget(t *testing.T) {
	for _, tc := range []struct {
		enabled               bool
		budget                int64
		typed, legacy, serial int
	}{{true, 1 << 20, 3, 0, 0}, {false, 1 << 20, 0, 3, 0}, {true, 1, 0, 0, 3}} {
		writer, transport := operationsRouteFixture(t, tc.enabled)
		factory := func(e projector.Emitter) (ledgerProcessor, error) { return operationRouteProcessor{e}, nil }
		if _, err := projectOrdered(context.Background(), &fixtureLedgerSource{count: 3}, 1, 1, writer, factory, tc.budget); err != nil {
			t.Fatal(err)
		}
		if writer.typed != tc.typed || writer.legacy != tc.legacy || writer.serial != tc.serial || writer.TotalRows() != 3 || transport.requests.Load() != 0 {
			t.Fatal("route or counters changed", tc)
		}
	}
	writer, _ := operationsRouteFixture(t, true)
	row := orderedOperationRow(1)
	body, err := writer.PrepareRow("history_operations", row)
	if err != nil {
		t.Fatal(err)
	}
	buffer := &ledgerRowBuffer{writer: writer, maxBytes: 1 << 20}
	if err := buffer.Emit(context.Background(), "history_operations", 1, row); err != nil {
		t.Fatal(err)
	}
	p := buffer.rows[0].native
	if p == nil || buffer.bytes != int64(len(body)+p.RetainedBytes()) || writer.TotalRows() != 0 {
		t.Fatal("typed representation was not charged to existing budget")
	}
	buffer.maxBytes, buffer.bytes, buffer.rows = int64(len(body)), 0, nil
	if err := buffer.Emit(context.Background(), "history_operations", 1, row); !errors.Is(err, errProjectionBufferFull) || len(buffer.rows) != 0 {
		t.Fatal("memory budget fallback changed")
	}
}
