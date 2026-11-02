package clickhouse

import (
	"bytes"
	"context"
	"time"
)

// Shared across async writers/clients: a permit covers Native encoding and HTTP.
// Default serial writers retain their existing execution behavior.
var datasetInsertPermits = make(chan struct{}, 4)

type pendingInsert struct {
	native    *typedNativeChunk
	done      chan struct{}
	cancel    context.CancelFunc
	bytes     int
	rows      int
	jsonBytes int
	timings   insertTimings
	elapsed   time.Duration
	err       error
}

// WaitPending joins only already scheduled dataset jobs, never buffered rows or
// holder/pool work. The ordered caller alone merges results and updates stats.
// Cancellation cancels all outstanding jobs, then still joins them before
// returning; callers can safely free batch data even on projection failure.
// Like Emit/Flush, this method must not be called concurrently on one writer.
func (w *BatchWriter) WaitPending(ctx context.Context) error {
	for len(w.pendingInserts) > 0 {
		w.joinFirstInsert(ctx)
	}
	return w.pendingInsertError
}

func (w *BatchWriter) joinFirstInsert(ctx context.Context) {
	job := w.pendingInserts[0]
	select {
	case <-job.done:
	default:
		started := time.Now()
		select {
		case <-job.done:
		case <-ctx.Done():
			w.rememberInsertError(ctx.Err())
			for _, pending := range w.pendingInserts {
				pending.cancel()
			}
			<-job.done
		}
		w.pendingJoinElapsed += time.Since(started)
	}
	job.cancel()
	w.pendingInserts[0] = nil
	w.pendingInserts = w.pendingInserts[1:]
	w.pendingInsertBytes -= job.bytes
	w.flushElapsed += job.elapsed
	w.insertTimings.add(job.timings)
	w.rememberInsertError(job.err)
	if job.err == nil {
		w.flushedRows += uint64(job.rows)
		w.flushedChunks++
		w.flushedJSONBytes += uint64(job.jsonBytes)
	}
}

func (w *BatchWriter) rememberInsertError(err error) {
	if w.pendingInsertError == nil && err != nil {
		w.pendingInsertError = err
	}
}

func (w *BatchWriter) scheduleInsert(ctx context.Context, dataset, token string, table *tableBuffer) error {
	// Reap acknowledged jobs before admitting more work, including any error.
	for len(w.pendingInserts) > 0 {
		select {
		case <-w.pendingInserts[0].done:
			w.joinFirstInsert(ctx)
		default:
			goto admission
		}
	}
admission:
	if w.pendingInsertError != nil {
		return w.pendingInsertError
	}
	if err := ctx.Err(); err != nil {
		w.rememberInsertError(err)
		return err
	}
	reserved := table.body.Cap()
	if table.nativeBuffer != nil {
		reserved = max(reserved, table.nativeBuffer.reservation())
	}
	if reserved > w.limits.MaximumPendingInsertBytes {
		// An indivisible oversize chunk keeps its original boundary/body/token.
		// Drain first, then run synchronously under the same global permit cap.
		if err := w.WaitPending(ctx); err != nil {
			return err
		}
		job := &pendingInsert{rows: table.bufferRows, jsonBytes: table.body.Len(), native: detachTypedNative(table)}
		if job.native != nil {
			job.timings.nativeEncode = job.native.preEncode
		}
		body := table.body.Bytes()
		if job.native != nil {
			body = nil
			table.body = bytes.Buffer{}
		}
		w.runInsert(ctx, dataset, token, body, job)
		w.flushElapsed += job.elapsed
		w.insertTimings.add(job.timings)
		w.rememberInsertError(job.err)
		if job.err != nil {
			return job.err
		}
		w.flushedRows += uint64(job.rows)
		w.flushedChunks++
		w.flushedJSONBytes += uint64(job.jsonBytes)
		table.body.Reset()
		table.bufferRows = 0
		table.chunk++
		return nil
	}
	for len(w.pendingInserts) >= w.limits.MaximumPendingInserts ||
		w.pendingInsertBytes > w.limits.MaximumPendingInsertBytes-reserved {
		w.joinFirstInsert(ctx)
		if w.pendingInsertError != nil {
			return w.pendingInsertError
		}
	}
	jobCtx, cancel := context.WithCancel(ctx)
	job := &pendingInsert{
		done: make(chan struct{}), cancel: cancel, bytes: reserved,
		rows: table.bufferRows, jsonBytes: table.body.Len(),
		native: detachTypedNative(table),
	}
	if job.native != nil {
		job.timings.nativeEncode = job.native.preEncode
	}
	body := table.body.Bytes()
	if job.native != nil {
		body = nil
	}
	// Detach rather than Reset: workers own immutable storage until joined.
	table.body = bytes.Buffer{}
	table.bufferRows = 0
	table.chunk++
	w.pendingInserts = append(w.pendingInserts, job)
	w.pendingInsertBytes += reserved
	go func() {
		w.runInsert(jobCtx, dataset, token, body, job)
		close(job.done)
	}()
	return nil
}

func (w *BatchWriter) runInsert(ctx context.Context, dataset, token string, body []byte, job *pendingInsert) {
	if err := ctx.Err(); err != nil {
		job.err = err
		return
	}
	permitStarted := time.Now()
	select {
	case datasetInsertPermits <- struct{}{}:
		defer func() { <-datasetInsertPermits }()
	case <-ctx.Done():
		job.timings.permitWait += time.Since(permitStarted)
		job.err = ctx.Err()
		return
	}
	job.timings.permitWait += time.Since(permitStarted)
	started := time.Now()
	if job.native != nil {
		job.err = w.client.insertEncodedNative(ctx, dataset, token, job.native, &job.timings)
	} else {
		job.err = w.client.insert(ctx, dataset, token, body, &job.timings)
	}
	job.elapsed = time.Since(started)
}
