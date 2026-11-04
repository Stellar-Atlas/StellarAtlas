package ingestion

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stellar/go-stellar-sdk/xdr"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/projector"
)

type fixtureLedgerSource struct {
	count   int
	decoded atomic.Int32
}

func (s *fixtureLedgerSource) ForEach(_ int64, fn func(xdr.LedgerCloseMeta) error) error {
	for i := 1; i <= s.count; i++ {
		s.decoded.Add(1)
		meta := xdr.LedgerCloseMeta{V: 0, V0: &xdr.LedgerCloseMetaV0{
			LedgerHeader: xdr.LedgerHeaderHistoryEntry{Header: xdr.LedgerHeader{LedgerSeq: xdr.Uint32(i)}},
		}}
		if err := fn(meta); err != nil {
			return err
		}
	}
	return nil
}

type recordedFixtureRow struct {
	Dataset string
	Row     any
}

// A prerecorded projected stream deliberately tests transport ordering, not
// independent SDK map iteration. Those independent streams need not be equal.
var recordedLedger = []recordedFixtureRow{
	{"history_ledgers", map[string]any{"a": "first", "z": 1}},
	{"history_operations", map[string]any{"type": "payment", "amount": "17.25"}},
	{"history_operations", map[string]any{"type": "create_account", "amount": "2"}},
}

type fixtureProcessor struct {
	emitter projector.Emitter
	hook    func(context.Context, uint32) error
}

func (p fixtureProcessor) ProcessLedger(ctx context.Context, meta xdr.LedgerCloseMeta) error {
	seq := meta.LedgerSequence()
	if p.hook != nil {
		if err := p.hook(ctx, seq); err != nil {
			return err
		}
	}
	for _, row := range recordedLedger {
		if err := p.emitter.Emit(ctx, row.Dataset, seq, row.Row); err != nil {
			return err
		}
	}
	return nil
}

type fixtureWriter struct {
	rows     []string
	prepared atomic.Int32
	serial   int
	hook     func(context.Context) error
}

func (*fixtureWriter) VirtualLedgerTransactions() bool { return true }
func (w *fixtureWriter) PrepareRow(_ string, row any) ([]byte, error) {
	w.prepared.Add(1)
	return json.Marshal(row)
}
func (w *fixtureWriter) Emit(ctx context.Context, dataset string, ledger uint32, row any) error {
	w.serial++
	body, err := json.Marshal(row)
	if err != nil {
		return err
	}
	return w.EmitPrepared(ctx, dataset, ledger, body)
}
func (w *fixtureWriter) EmitPrepared(ctx context.Context, dataset string, ledger uint32, body []byte) error {
	if w.hook != nil {
		if err := w.hook(ctx); err != nil {
			return err
		}
	}
	w.rows = append(w.rows, fmt.Sprintf("%s/%d/%s", dataset, ledger, body))
	return nil
}
func fixtureFactory(hook func(context.Context, uint32) error) processorFactory {
	return func(e projector.Emitter) (ledgerProcessor, error) { return fixtureProcessor{e, hook}, nil }
}

func TestOrderedProjectionMatchesRecordedSerialStream(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	serial := &fixtureWriter{}
	processor, _ := fixtureFactory(nil)(serial)
	if err := (&fixtureLedgerSource{count: 12}).ForEach(1, func(m xdr.LedgerCloseMeta) error { return processor.ProcessLedger(ctx, m) }); err != nil {
		t.Fatal(err)
	}
	parallel := &fixtureWriter{}
	stats, err := projectOrdered(ctx, &fixtureLedgerSource{count: 12}, 1, 1, parallel, fixtureFactory(func(_ context.Context, seq uint32) error {
		// Force later ledgers to finish first.
		time.Sleep(time.Duration(4-seq%4) * time.Millisecond)
		return nil
	}), maxPreparedLedgerBytes)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(serial.rows, parallel.rows) {
		t.Fatal("prepared rows changed bytes or ledger/per-ledger order")
	}
	if parallel.serial != 0 || stats.SerialFallbacks != 0 {
		t.Fatal("unexpected serial fallback")
	}
	if stats.TotalElapsed <= 0 || stats.LedgerDecodeElapsed < 0 {
		t.Fatal("invalid timing")
	}
}

func TestOrderedProjectionWindowAndPermitReleasedBeforeSink(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	entered, release := make(chan struct{}), make(chan struct{})
	var completed atomic.Int32
	writer := &fixtureWriter{hook: func(ctx context.Context) error {
		select {
		case <-entered:
		default:
			close(entered)
		}
		select {
		case <-release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}}
	source := &fixtureLedgerSource{count: 20}
	done := make(chan error, 1)
	go func() {
		_, err := projectOrdered(ctx, source, 1, 1, writer, fixtureFactory(func(context.Context, uint32) error { completed.Add(1); return nil }), maxPreparedLedgerBytes)
		done <- err
	}()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	deadline := time.Now().Add(time.Second)
	for completed.Load() < 4 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if source.decoded.Load() != 4 {
		t.Fatalf("decoded %d while sink held: expected exactly 4", source.decoded.Load())
	}
	deadline = time.Now().Add(time.Second)
	for len(projectionPermits) != 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if len(projectionPermits) != 0 {
		t.Fatal("completed projection retains CPU permit while sink blocked")
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestOrderedProjectionOverflowAndHugeBatchSerial(t *testing.T) {
	for _, huge := range []bool{false, true} {
		t.Run(fmt.Sprintf("huge=%v", huge), func(t *testing.T) {
			writer := &fixtureWriter{}
			bytes := int64(1)
			if huge {
				bytes = maxParallelBatchBytes + 1
			}
			stats, err := projectOrdered(context.Background(), &fixtureLedgerSource{count: 7}, 1, bytes, writer, fixtureFactory(nil), 1)
			if err != nil {
				t.Fatal(err)
			}
			serial := &fixtureWriter{}
			processor, _ := fixtureFactory(nil)(serial)
			_ = (&fixtureLedgerSource{count: 7}).ForEach(1, func(m xdr.LedgerCloseMeta) error { return processor.ProcessLedger(context.Background(), m) })
			if !reflect.DeepEqual(serial.rows, writer.rows) || writer.serial != 21 {
				t.Fatal("serial fallback changed rows")
			}
			if huge && writer.prepared.Load() != 0 {
				t.Fatal("huge batch entered prepared path")
			}
			if !huge && stats.SerialFallbacks != 7 {
				t.Fatal("overflow fallback count mismatch")
			}
		})
	}
}

func TestOrderedProjectionSinkErrorCancelsAndJoinsWorkers(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	want := errors.New("sink failed")
	var active atomic.Int32
	writer := &fixtureWriter{hook: func(context.Context) error { return want }}
	stats, err := projectOrdered(ctx, &fixtureLedgerSource{count: 100}, 1, 1, writer, fixtureFactory(func(ctx context.Context, seq uint32) error {
		active.Add(1)
		defer active.Add(-1)
		if seq == 1 {
			return nil
		}
		<-ctx.Done()
		return ctx.Err()
	}), maxPreparedLedgerBytes)
	if !errors.Is(err, want) {
		t.Fatalf("got %v, want sink error", err)
	}
	if active.Load() != 0 || len(projectionPermits) != 0 {
		t.Fatal("return left active workers or held CPU permits")
	}
	if stats.TotalElapsed > time.Second {
		t.Fatal("worker cancellation did not drain promptly")
	}
}

func TestOrderedProjectionProjectionErrorAndCanceledContext(t *testing.T) {
	want := errors.New("projection failed")
	writer := &fixtureWriter{}
	_, err := projectOrdered(context.Background(), &fixtureLedgerSource{count: 20}, 1, 1, writer, fixtureFactory(func(_ context.Context, seq uint32) error {
		if seq == 2 {
			return want
		}
		return nil
	}), maxPreparedLedgerBytes)
	if !errors.Is(err, want) || len(writer.rows) != len(recordedLedger) {
		t.Fatalf("error/order mismatch: %v rows=%d", err, len(writer.rows))
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	writer = &fixtureWriter{}
	_, err = projectOrdered(ctx, &fixtureLedgerSource{count: 20}, 1, 1, writer, fixtureFactory(nil), maxPreparedLedgerBytes)
	if !errors.Is(err, context.Canceled) || len(writer.rows) != 0 || len(projectionPermits) != 0 {
		t.Fatalf("cancellation mismatch: %v", err)
	}
}

func TestOrderedProjectionGlobalEightCPUWorkersAcrossBatches(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	entered, release := make(chan struct{}, 12), make(chan struct{})
	var active, peak atomic.Int32
	hook := func(ctx context.Context, _ uint32) error {
		current := active.Add(1)
		defer active.Add(-1)
		for old := peak.Load(); current > old && !peak.CompareAndSwap(old, current); old = peak.Load() {
		}
		entered <- struct{}{}
		select {
		case <-release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	done := make(chan error, 3)
	for i := 0; i < 3; i++ {
		go func() {
			_, err := projectOrdered(ctx, &fixtureLedgerSource{count: 4}, 1, 1, &fixtureWriter{}, fixtureFactory(hook), maxPreparedLedgerBytes)
			done <- err
		}()
	}
	for i := 0; i < 8; i++ {
		select {
		case <-entered:
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
	select {
	case <-entered:
		t.Fatal("more than eight concurrent CPU projections")
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	for i := 0; i < 3; i++ {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
	if peak.Load() != 8 || active.Load() != 0 || len(projectionPermits) != 0 {
		t.Fatalf("bad global CPU bounds: peak=%d active=%d", peak.Load(), active.Load())
	}
}

func TestOrderedProjectionSerialFallbackYieldsCPUWhileSinkWaits(t *testing.T) {
	for _, huge := range []bool{false, true} {
		t.Run(fmt.Sprintf("huge=%v", huge), func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			entered := make(chan struct{})
			writer := &fixtureWriter{hook: func(ctx context.Context) error {
				close(entered)
				<-ctx.Done()
				return ctx.Err()
			}}
			done := make(chan error, 1)
			bytes := int64(1)
			if huge {
				bytes = maxParallelBatchBytes + 1
			}
			go func() {
				_, err := projectOrdered(ctx, &fixtureLedgerSource{count: 1}, 1, bytes, writer, fixtureFactory(nil), 1)
				done <- err
			}()
			select {
			case <-entered:
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			if len(projectionPermits) != 0 {
				t.Fatal("serial fallback retains CPU permit during writer wait")
			}
			cancel()
			if err := <-done; !errors.Is(err, context.Canceled) {
				t.Fatalf("got %v", err)
			}
			if len(projectionPermits) != 0 {
				t.Fatal("serial cancellation leaked permit")
			}
		})
	}
}

func TestOrderedProjectionWritesRetainAdmittedContextAfterSuccess(t *testing.T) {
	for _, mode := range []string{"prepared", "overflow", "huge"} {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			var writeContexts []context.Context
			writer := &fixtureWriter{hook: func(writeCtx context.Context) error {
				writeContexts = append(writeContexts, writeCtx)
				return nil
			}}
			batchBytes, maxBytes := int64(1), maxPreparedLedgerBytes
			if mode == "overflow" {
				maxBytes = 1
			} else if mode == "huge" {
				batchBytes = maxParallelBatchBytes + 1
			}
			_, err := projectOrdered(ctx, &fixtureLedgerSource{count: 2}, 1, batchBytes, writer, fixtureFactory(nil), maxBytes)
			if err != nil {
				t.Fatal(err)
			}
			if len(writeContexts) != 2*len(recordedLedger) {
				t.Fatalf("unexpected writer calls: %d", len(writeContexts))
			}
			for _, writeCtx := range writeContexts {
				if writeCtx.Err() != nil {
					t.Fatal("successful projection cleanup canceled a queued write")
				}
			}
			cancel()
			for _, writeCtx := range writeContexts {
				if !errors.Is(writeCtx.Err(), context.Canceled) {
					t.Fatal("queued write did not retain admitted parent cancellation")
				}
			}
		})
	}
}
