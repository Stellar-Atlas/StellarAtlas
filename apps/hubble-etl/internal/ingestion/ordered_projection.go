package ingestion

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/pkg/lcmbatch"
	"github.com/stellar/go-stellar-sdk/xdr"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/clickhouse"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/projector"
)

// preparedRowWriter must prepare using immutable configuration only. Only the
// calling goroutine uses Emit/EmitPrepared: ordinals, holders and flushes stay
// owned by the original batch writer.
type preparedRowWriter interface {
	projector.Emitter
	VirtualLedgerTransactions() bool
	PrepareRow(string, any) ([]byte, error)
	EmitPrepared(context.Context, string, uint32, []byte) error
}

// Optional typed preparation retains JSON for unchanged chunk boundaries.
// Both representations share the same per-ledger memory budget.
type preparedNativeWriter interface {
	PrepareNativeRow(string, any) (*clickhouse.PreparedNativeRow, error)
	EmitPreparedNative(context.Context, string, uint32, []byte, *clickhouse.PreparedNativeRow) error
}

type ledgerSource interface {
	ForEach(int64, func(xdr.LedgerCloseMeta) error) error
}

type ledgerProcessor interface {
	ProcessLedger(context.Context, xdr.LedgerCloseMeta) error
}

type processorFactory func(projector.Emitter) (ledgerProcessor, error)

type orderedProjectionStats struct {
	// Worker and sink durations overlap; never subtract their sum from wall.
	TotalElapsed, LedgerDecodeElapsed, ProjectionWorkerElapsed, OrderedEmitElapsed time.Duration
	SerialFallbacks                                                                int
}

type preparedRow struct {
	dataset string
	ledger  uint32
	body    []byte
	native  *clickhouse.PreparedNativeRow
}

type ledgerProjection struct {
	rows     []preparedRow
	fallback *xdr.LedgerCloseMeta // Only an overflow retains decoded meta.
	err      error
	elapsed  time.Duration
}

var errProjectionBufferFull = errors.New("ledger prepared output exceeds bounded buffer")

// Shared across batches, and released before an ordered result waits for its
// sink. A slow ClickHouse flush must not hold a CPU projection permit.
var projectionPermits = make(chan struct{}, 8)

const (
	orderedProjectionWindow = 4
	maxPreparedLedgerBytes  = int64(256 << 20)
	maxParallelBatchBytes   = int64(4 << 30)
)

func projectBatchOrdered(ctx context.Context, batch *lcmbatch.Batch, maxMemory int64, network string, writer preparedRowWriter) (orderedProjectionStats, error) {
	factory := func(emitter projector.Emitter) (ledgerProcessor, error) {
		return projector.New(network, emitter)
	}
	return projectOrdered(ctx, batch, maxMemory, batch.UncompressedBytes, writer, factory, maxPreparedLedgerBytes)
}

// projectOrdered returns only after both source iteration and every worker have
// stopped. Its caller may therefore safely defer Batch.Close. It derives from
// the already-admitted batch context, not the outer admission/drain context.
func projectOrdered(ctx context.Context, source ledgerSource, maxMemory, batchBytes int64, writer preparedRowWriter, factory processorFactory, maxBytes int64) (stats orderedProjectionStats, finalErr error) {
	started := time.Now()
	defer func() { stats.TotalElapsed = time.Since(started) }()
	serialEmitter := &serialProjectionEmitter{writer: writer, writeCtx: ctx}
	serial, err := factory(serialEmitter)
	if err != nil {
		return stats, err
	}
	if batchBytes > maxParallelBatchBytes {
		var callbackElapsed time.Duration
		err = source.ForEach(maxMemory, func(meta xdr.LedgerCloseMeta) error {
			callbackStarted := time.Now()
			defer func() { callbackElapsed += time.Since(callbackStarted) }()
			projectStarted := time.Now()
			err := serialEmitter.processLedger(ctx, serial, meta)
			stats.ProjectionWorkerElapsed += time.Since(projectStarted)
			return err
		})
		stats.LedgerDecodeElapsed = time.Since(started) - callbackElapsed
		return stats, err
	}
	workCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	window := make(chan struct{}, orderedProjectionWindow)
	futures := make(chan chan ledgerProjection, orderedProjectionWindow)
	producerDone := make(chan struct{})
	var workers sync.WaitGroup
	var producerErr error
	var decodeElapsed time.Duration
	go func() {
		defer close(producerDone)
		defer close(futures)
		reserve := func() error {
			select {
			case window <- struct{}{}:
				if err := workCtx.Err(); err != nil {
					<-window
					return err
				}
				return nil
			case <-workCtx.Done():
				return workCtx.Err()
			}
		}
		// Reserve before ForEach decodes its first/next object. A reservation
		// made after the final callback is unused and must be returned below.
		if producerErr = reserve(); producerErr != nil {
			return
		}
		reserved := true
		var callbackElapsed time.Duration
		iterateStarted := time.Now()
		producerErr = source.ForEach(maxMemory, func(meta xdr.LedgerCloseMeta) error {
			callbackStarted := time.Now()
			defer func() { callbackElapsed += time.Since(callbackStarted) }()
			if err := workCtx.Err(); err != nil {
				return err
			}
			future := make(chan ledgerProjection, 1)
			select {
			case futures <- future:
			case <-workCtx.Done():
				return workCtx.Err()
			}
			reserved = false // This reservation now belongs to the sink.
			workers.Add(1)
			go func() {
				defer workers.Done()
				future <- prepareLedger(workCtx, meta, writer, factory, maxBytes)
			}()
			if err := reserve(); err != nil {
				return err
			}
			reserved = true
			return nil
		})
		decodeElapsed = time.Since(iterateStarted) - callbackElapsed
		if reserved {
			<-window
		}
	}()
	// Cancellation unblocks a producer waiting for a window reservation. Join
	// producer before workers.Wait: all Add calls must precede Wait.
	defer func() {
		cancel()
		<-producerDone
		workers.Wait()
		stats.LedgerDecodeElapsed = decodeElapsed
	}()
	for future := range futures {
		var result ledgerProjection
		select {
		case result = <-future:
		case <-workCtx.Done():
			return stats, workCtx.Err()
		}
		stats.ProjectionWorkerElapsed += result.elapsed
		if result.err != nil {
			return stats, result.err
		}
		if err := workCtx.Err(); err != nil {
			return stats, err
		}
		if result.fallback != nil {
			stats.SerialFallbacks++
			fallbackStarted := time.Now()
			err = serialEmitter.processLedger(workCtx, serial, *result.fallback)
			stats.ProjectionWorkerElapsed += time.Since(fallbackStarted)
			if err != nil {
				return stats, err
			}
		} else {
			emitStarted := time.Now()
			for _, row := range result.rows {
				// Queued writes must outlive successful projection cleanup and
				// remain governed by the admitted batch through File.Flush.
				var err error
				if row.native != nil {
					err = writer.(preparedNativeWriter).EmitPreparedNative(ctx, row.dataset, row.ledger, row.body, row.native)
				} else {
					err = writer.EmitPrepared(ctx, row.dataset, row.ledger, row.body)
				}
				if err != nil {
					return stats, err
				}
			}
			stats.OrderedEmitElapsed += time.Since(emitStarted)
		}
		<-window
	}
	<-producerDone
	return stats, producerErr
}

// Serial overflow/size fallbacks keep the original ProcessLedger->Emit stream.
// Yield only around the synchronous writer, then reacquire before transformation
// resumes. The eight-permit bound covers projection, not writer marshaling CPU
// (the latter remains bounded by the number of admitted batches).
type serialProjectionEmitter struct {
	writer   preparedRowWriter
	writeCtx context.Context
	held     bool // Single ordered sink goroutine owns this flag.
}

func (e *serialProjectionEmitter) VirtualLedgerTransactions() bool {
	return e.writer.VirtualLedgerTransactions()
}

func (e *serialProjectionEmitter) processLedger(ctx context.Context, processor ledgerProcessor, meta xdr.LedgerCloseMeta) error {
	if err := acquireProjection(ctx); err != nil {
		return err
	}
	e.held = true
	defer func() {
		if e.held {
			<-projectionPermits
			e.held = false
		}
	}()
	return processor.ProcessLedger(ctx, meta)
}

func (e *serialProjectionEmitter) Emit(ctx context.Context, dataset string, ledger uint32, row any) error {
	if !e.held {
		return fmt.Errorf("serial projection emitted without a CPU permit")
	}
	<-projectionPermits
	e.held = false
	if err := e.writer.Emit(e.writeCtx, dataset, ledger, row); err != nil {
		return err
	}
	if err := acquireProjection(ctx); err != nil {
		return err
	}
	e.held = true
	return nil
}

func acquireProjection(ctx context.Context) error {
	select {
	case projectionPermits <- struct{}{}:
		if err := ctx.Err(); err != nil {
			<-projectionPermits
			return err
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func prepareLedger(ctx context.Context, meta xdr.LedgerCloseMeta, writer preparedRowWriter, factory processorFactory, maxBytes int64) ledgerProjection {
	if err := acquireProjection(ctx); err != nil {
		return ledgerProjection{err: err}
	}
	defer func() { <-projectionPermits }()
	started := time.Now()
	buffer := &ledgerRowBuffer{writer: writer, maxBytes: maxBytes, virtual: writer.VirtualLedgerTransactions()}
	processor, err := factory(buffer)
	if err == nil {
		err = processor.ProcessLedger(ctx, meta)
	}
	result := ledgerProjection{elapsed: time.Since(started), err: err}
	if errors.Is(err, errProjectionBufferFull) {
		result.fallback, result.err = &meta, nil
	} else if err == nil {
		result.rows = buffer.rows
	}
	return result
}

type ledgerRowBuffer struct {
	writer   preparedRowWriter
	rows     []preparedRow
	bytes    int64
	maxBytes int64
	virtual  bool
}

func (b *ledgerRowBuffer) VirtualLedgerTransactions() bool { return b.virtual }

func (b *ledgerRowBuffer) Emit(ctx context.Context, dataset string, ledger uint32, row any) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	body, err := b.writer.PrepareRow(dataset, row)
	if err != nil {
		return err
	}
	var native *clickhouse.PreparedNativeRow
	if typed, ok := b.writer.(preparedNativeWriter); ok && (dataset == "history_effects" || dataset == "history_contract_events" || dataset == "history_operations") {
		native, err = typed.PrepareNativeRow(dataset, row)
		if err != nil {
			return err
		}
	}
	retained := int64(len(body)) + int64(native.RetainedBytes())
	if retained < 0 || retained > b.maxBytes-b.bytes {
		b.rows = nil // Nothing from this ledger has reached the writer.
		return errProjectionBufferFull
	}
	b.bytes += retained
	b.rows = append(b.rows, preparedRow{dataset: dataset, ledger: ledger, body: body, native: native})
	return nil
}
