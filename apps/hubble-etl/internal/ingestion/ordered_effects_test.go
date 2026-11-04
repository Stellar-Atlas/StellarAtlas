package ingestion

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stellar/go-stellar-sdk/xdr"
	"github.com/stellar/stellar-etl/v2/internal/transform"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/clickhouse"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/projector"
)

type forbiddenEffectsTransport struct{ requests atomic.Int32 }

func (t *forbiddenEffectsTransport) RoundTrip(*http.Request) (*http.Response, error) {
	t.requests.Add(1)
	return nil, fmt.Errorf("projection-only test must not issue an HTTP request")
}

type effectsRouteWriter struct {
	*clickhouse.BatchWriter
	typed, legacy, serial int
	contexts              []context.Context
}

func (w *effectsRouteWriter) Emit(ctx context.Context, dataset string, ledger uint32, row any) error {
	w.serial++
	w.contexts = append(w.contexts, ctx)
	return w.BatchWriter.Emit(ctx, dataset, ledger, row)
}
func (w *effectsRouteWriter) EmitPrepared(ctx context.Context, dataset string, ledger uint32, body []byte) error {
	w.legacy++
	w.contexts = append(w.contexts, ctx)
	return w.BatchWriter.EmitPrepared(ctx, dataset, ledger, body)
}
func (w *effectsRouteWriter) EmitPreparedNative(ctx context.Context, dataset string, ledger uint32, body []byte, row *clickhouse.PreparedNativeRow) error {
	w.typed++
	w.contexts = append(w.contexts, ctx)
	return w.BatchWriter.EmitPreparedNative(ctx, dataset, ledger, body, row)
}

func effectsWriterFixture(t *testing.T, enabled bool) (*effectsRouteWriter, *forbiddenEffectsTransport) {
	t.Helper()
	transport := &forbiddenEffectsTransport{}
	client, err := clickhouse.New(clickhouse.Config{
		Endpoint: "http://127.0.0.1:1", Database: "effects_route_fixture",
		HTTPClient: &http.Client{Transport: transport},
	})
	if err != nil {
		t.Fatal(err)
	}
	writer, err := clickhouse.NewBatchWriter(client, clickhouse.BatchIdentity{
		ID: "0a1b2c3d-4e5f-4678-8910-112233445566", SourceSHA256: strings.Repeat("a", 64),
		StartLedger: 1, EndLedger: 3,
	}, clickhouse.WriterLimits{MaximumRows: 1000, MaximumBytes: 1 << 20, TypedEffects: enabled, TypedEvents: enabled})
	if err != nil {
		t.Fatal(err)
	}
	return &effectsRouteWriter{BatchWriter: writer}, transport
}

func effectsRowFixture(ledger uint32) transform.EffectOutput {
	return transform.EffectOutput{
		Address: "fixture-account", OperationID: int64(ledger),
		Details: map[string]interface{}{"amount": "123.0000001", "counter": 5},
		Type:    1, TypeString: "fixture", LedgerClosed: time.Unix(1700000000, 0).UTC(),
		LedgerSequence: ledger, EffectIndex: 1,
	}
}

type effectsRouteProcessor struct {
	emitter projector.Emitter
	events  bool
}

func (p effectsRouteProcessor) ProcessLedger(ctx context.Context, meta xdr.LedgerCloseMeta) error {
	if p.events {
		ledger := meta.LedgerSequence()
		row := transform.ContractEventOutput{TransactionHash: strings.Repeat("a", 64), TransactionID: int64(ledger),
			Successful: true, LedgerSequence: ledger, ClosedAt: time.Unix(1700000000, 0).UTC(),
			InSuccessfulContractCall: true, ContractId: "fixture-contract", Type: 1, TypeString: "contract",
			Topics: []interface{}{"transfer", "001"}, TopicsDecoded: []interface{}{map[string]interface{}{"symbol": "transfer"}},
			Data: "100", DataDecoded: map[string]interface{}{"i128": "100"}, ContractEventXDR: "AAAA"}
		return p.emitter.Emit(ctx, "history_contract_events", ledger, row)
	}
	return p.emitter.Emit(ctx, "history_effects", meta.LedgerSequence(), effectsRowFixture(meta.LedgerSequence()))
}

func TestOrderedEffectsRouteKeepsParentContextAndFallbacks(t *testing.T) {
	for _, tc := range []struct {
		name                  string
		enabled               bool
		batchBytes, budget    int64
		typed, legacy, serial int
		events                bool
	}{
		{"typed", true, 1, 1 << 20, 3, 0, 0, false},
		{"disabled", false, 1, 1 << 20, 0, 3, 0, false},
		{"overflow", true, 1, 1, 0, 0, 3, false},
		{"large-batch", true, maxParallelBatchBytes + 1, 1 << 20, 0, 0, 3, false},
		{"events-typed", true, 1, 1 << 20, 3, 0, 0, true},
		{"events-disabled", false, 1, 1 << 20, 0, 3, 0, true},
		{"events-overflow", true, 1, 1, 0, 0, 3, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			writer, transport := effectsWriterFixture(t, tc.enabled)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			factory := func(e projector.Emitter) (ledgerProcessor, error) { return effectsRouteProcessor{e, tc.events}, nil }
			_, err := projectOrdered(ctx, &fixtureLedgerSource{count: 3}, 1, tc.batchBytes, writer, factory, tc.budget)
			if err != nil {
				t.Fatal(err)
			}
			if writer.typed != tc.typed || writer.legacy != tc.legacy || writer.serial != tc.serial || writer.TotalRows() != 3 {
				t.Fatalf("unexpected routes/counts: typed=%d legacy=%d serial=%d rows=%d", writer.typed, writer.legacy, writer.serial, writer.TotalRows())
			}
			for _, writeCtx := range writer.contexts {
				if writeCtx.Err() != nil {
					t.Fatal("successful projection canceled admitted write context")
				}
			}
			cancel()
			for _, writeCtx := range writer.contexts {
				if !errors.Is(writeCtx.Err(), context.Canceled) {
					t.Fatal("write context did not follow parent cancellation")
				}
			}
			if transport.requests.Load() != 0 {
				t.Fatal("projection-only fixture performed HTTP")
			}
		})
	}
}

func TestOrderedEffectsChargesTypedRepresentationToLedgerBudget(t *testing.T) {
	writer, _ := effectsWriterFixture(t, true)
	row := effectsRowFixture(1)
	body, err := writer.PrepareRow("history_effects", row)
	if err != nil {
		t.Fatal(err)
	}
	buffer := &ledgerRowBuffer{writer: writer, maxBytes: 1 << 20}
	if err := buffer.Emit(context.Background(), "history_effects", 1, row); err != nil {
		t.Fatal(err)
	}
	prepared := buffer.rows[0].native
	if prepared == nil || buffer.bytes != int64(len(body)+prepared.RetainedBytes()) || writer.TotalRows() != 0 {
		t.Fatal("typed preparation must remain uncommitted and fully budgeted")
	}
	buffer.maxBytes = int64(len(body))
	buffer.bytes, buffer.rows = 0, nil
	if err := buffer.Emit(context.Background(), "history_effects", 1, row); !errors.Is(err, errProjectionBufferFull) || len(buffer.rows) != 0 {
		t.Fatal("typed allocation exceeded the ledger budget without serial fallback")
	}
}
