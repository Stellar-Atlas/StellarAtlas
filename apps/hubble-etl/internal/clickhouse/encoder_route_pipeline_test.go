package clickhouse

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

func routePipelineBytes(t *testing.T, w *BatchWriter, row any, ordinal uint64) uint64 {
	t.Helper()
	body, err := encodeRow(row, w.identity, 1, ordinal, w.ingestedAt)
	if err != nil {
		t.Fatal(err)
	}
	return uint64(len(body) + 1)
}

func requirePipelineRoute(t *testing.T, w *BatchWriter, dataset, route string, offered, attempted, failed, ack EncoderRowBytes) {
	t.Helper()
	for _, got := range w.DatasetWriteStats().EncoderRoutes {
		if got.Dataset == dataset && got.Route == route {
			if got.Offered != offered || got.Attempted != attempted || got.Failed != failed || got.Acknowledged != ack || got.Overflow {
				t.Fatalf("route %s/%s: %+v; want offered=%+v attempted=%+v failed=%+v ack=%+v", dataset, route, got, offered, attempted, failed, ack)
			}
			return
		}
	}
	t.Fatalf("missing route %s/%s: %+v", dataset, route, w.DatasetWriteStats().EncoderRoutes)
}

func TestEncoderRouteSerialAndPending(t *testing.T) {
	for _, pending := range []int{0, 2} {
		for _, generic := range []bool{false, true} {
			t.Run(fmt.Sprintf("pending=%d/generic=%v", pending, generic), func(t *testing.T) {
				var capture effectsTestCapture
				w := nativeTestWriter(t, false, false, pending, 2, 0, &capture)
				dataset, route, format := "history_ledgers", "json-each-row", "FORMAT JSONEachRow"
				if generic {
					dataset, route, format = "history_contract_events", "generic-native", "FORMAT Native"
				}
				var offered uint64
				for i := range 3 {
					var row any = map[string]any{"id": i}
					if generic {
						row = json.RawMessage(`{"data_decoded":[true,1,"1",null,[]],"contract_event_xdr":"AAAA"}`)
					}
					offered += routePipelineBytes(t, w, row, uint64(i))
					if err := w.Emit(context.Background(), dataset, 1, row); err != nil {
						t.Fatal(err)
					}
				}
				if err := w.Flush(context.Background()); err != nil {
					t.Fatal(err)
				}
				count := EncoderRowBytes{Rows: 3, JSONBytes: offered}
				requirePipelineRoute(t, w, dataset, route, count, count, EncoderRowBytes{}, count)
				stats := w.DatasetWriteStats()
				if stats.Rows != 3 || stats.Chunks != 2 || stats.JSONBytes != offered || len(capture.calls) != 2 {
					t.Fatalf("ACK/chunk accounting changed: %+v calls=%d", stats, len(capture.calls))
				}
				var sentJSON uint64
				for _, call := range capture.calls {
					if !strings.Contains(call.query, format) || !strings.Contains(call.token, ":recovery:typed-effects-test") {
						t.Fatalf("request identity changed: %s %s", call.query, call.token)
					}
					if generic != strings.HasSuffix(call.token, ":native-v1") {
						t.Fatal("Native token classification changed", call.token)
					}
					sentJSON += uint64(len(call.body))
				}
				if !generic && sentJSON != offered {
					t.Fatal("JSON byte accounting excludes or duplicates retained bytes")
				}
			})
		}
	}
}

func TestEncoderRouteMixedTypedPreparedAndFallback(t *testing.T) {
	for _, pending := range []int{0, 2} {
		t.Run(fmt.Sprint(pending), func(t *testing.T) {
			var capture effectsTestCapture
			w := nativeTestWriter(t, false, true, pending, 2, 0, &capture)
			row := nativeTableFixture()
			body, err := w.PrepareRow("history_contract_events", row)
			if err != nil {
				t.Fatal(err)
			}
			prepared, err := w.PrepareNativeRow("history_contract_events", row)
			if err != nil || prepared == nil {
				t.Fatalf("fixture is not typed-prepared: %v", err)
			}
			preparedBytes := routePipelineBytes(t, w, row, 0)
			fallbackBytes := routePipelineBytes(t, w, row, 1)
			if err := w.EmitPreparedNative(context.Background(), "history_contract_events", 1, body, prepared); err != nil {
				t.Fatal(err)
			}
			if err := w.EmitPrepared(context.Background(), "history_contract_events", 1, body); err != nil {
				t.Fatal(err)
			}
			if err := w.Flush(context.Background()); err != nil {
				t.Fatal(err)
			}
			for route, size := range map[string]uint64{"typed-prepared": preparedBytes, "typed-json-fallback": fallbackBytes} {
				count := EncoderRowBytes{Rows: 1, JSONBytes: size}
				requirePipelineRoute(t, w, "history_contract_events", route, count, count, EncoderRowBytes{}, count)
			}
			stats := w.DatasetWriteStats()
			if stats.Rows != 2 || stats.Chunks != 1 || stats.JSONBytes != preparedBytes+fallbackBytes || len(capture.calls) != 1 {
				t.Fatalf("mixed chunk changed: %+v", stats)
			}
			call := capture.calls[0]
			blocks := effectsTestBlocks(t, call.body)
			if !strings.HasSuffix(call.token, ":typed-events-native-v1") || !strings.Contains(call.query, "FORMAT Native") || len(blocks) != 1 || len(blocks[0]) != 2 {
				t.Fatal("mixed routes changed typed request/body semantics")
			}
		})
	}
}

func TestEncoderRouteGenericPartialDecodeFailure(t *testing.T) {
	for _, pending := range []int{0, 2} {
		t.Run(fmt.Sprint(pending), func(t *testing.T) {
			var capture effectsTestCapture
			w := nativeTestWriter(t, false, false, pending, 2, 0, &capture)
			rows := []json.RawMessage{
				json.RawMessage(`{"data_decoded":[true],"contract_event_xdr":"AAAA"}`),
				json.RawMessage(`{"transaction_id":9223372036854775808,"data_decoded":null,"contract_event_xdr":"AAAA"}`),
			}
			var size uint64
			var emitErr error
			for i, row := range rows {
				size += routePipelineBytes(t, w, row, uint64(i))
				emitErr = w.Emit(context.Background(), "history_contract_events", 1, row)
				if i == 0 && emitErr != nil {
					t.Fatal(emitErr)
				}
			}
			err := emitErr
			if pending > 0 {
				if emitErr != nil {
					t.Fatal(emitErr)
				}
				err = w.WaitPending(context.Background())
			}
			if err == nil || !strings.Contains(err.Error(), "row 1 column transaction_id:") {
				t.Fatalf("partial conversion error changed: %v", err)
			}
			count := EncoderRowBytes{Rows: 2, JSONBytes: size}
			requirePipelineRoute(t, w, "history_contract_events", "generic-native", count, count, count, EncoderRowBytes{})
			if len(capture.calls) != 0 || w.DatasetWriteStats().Rows != 0 || w.DatasetWriteStats().Chunks != 0 {
				t.Fatal("partly decoded chunk was sent or acknowledged")
			}
		})
	}
}

func TestEncoderRouteTypedAppendRejectsOnlyOffendingMembership(t *testing.T) {
	var capture effectsTestCapture
	w := nativeTestWriter(t, false, true, 2, 10, 0, &capture)
	row := nativeTableFixture()
	body, err := w.PrepareRow("history_contract_events", row)
	if err != nil {
		t.Fatal(err)
	}
	p, err := w.PrepareNativeRow("history_contract_events", row)
	if err != nil || p == nil {
		t.Fatalf("fixture preparation failed: %v", err)
	}
	if err := w.EmitPreparedNative(context.Background(), "history_contract_events", 1, body, p); err != nil {
		t.Fatal(err)
	}
	bad := json.RawMessage(`{"unknown":1}`)
	err = w.EmitPrepared(context.Background(), "history_contract_events", 1, bad)
	if err == nil || !strings.Contains(err.Error(), "unknown history_contract_events column unknown") {
		t.Fatalf("typed append error changed: %v", err)
	}
	prefix := EncoderRowBytes{Rows: 1, JSONBytes: routePipelineBytes(t, w, row, 0)}
	rejected := EncoderRowBytes{Rows: 1, JSONBytes: routePipelineBytes(t, w, bad, 1)}
	requirePipelineRoute(t, w, "history_contract_events", "typed-prepared", prefix, EncoderRowBytes{}, EncoderRowBytes{}, EncoderRowBytes{})
	requirePipelineRoute(t, w, "history_contract_events", "typed-json-fallback", rejected, EncoderRowBytes{}, rejected, EncoderRowBytes{})
	if w.tables["history_contract_events"].bufferRows != 1 || w.TotalRows() != 1 {
		t.Fatal("rejected row became accepted chunk membership")
	}
	if flushErr := w.Flush(context.Background()); flushErr == nil || flushErr.Error() != err.Error() || len(capture.calls) != 0 {
		t.Fatal("failed typed append was sent or its error lost", flushErr)
	}
	// These counters describe membership only, not successful decoding of a prefix.
}

func TestEncoderRoutePendingOutcomesMergeOnlyOnJoin(t *testing.T) {
	started, release := make(chan struct{}, 1), make(chan struct{}, 1)
	defer close(release)
	w := nativeTestWriter(t, false, false, 2, 1, 0, effectsTestTransport(func(r *http.Request) (*http.Response, error) {
		_, _ = io.Copy(io.Discard, r.Body)
		started <- struct{}{}
		select {
		case <-release:
		case <-r.Context().Done():
			return nil, r.Context().Err()
		}
		return effectsTestResponse(), nil
	}))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := pipelineEmit(w, ctx, 1); err != nil {
		t.Fatal(err)
	}
	awaitPipeline(t, started)
	count := EncoderRowBytes{Rows: 1, JSONBytes: routePipelineBytes(t, w, map[string]any{"id": 1}, 0)}
	requirePipelineRoute(t, w, "history_ledgers", "json-each-row", count, EncoderRowBytes{}, EncoderRowBytes{}, EncoderRowBytes{})
	if w.DatasetWriteStats().Rows != 0 || w.DatasetWriteStats().Chunks != 0 {
		t.Fatal("blocked request falsely acknowledged")
	}
	// Release without closing so deferred cleanup is safe on every assertion path.
	release <- struct{}{}
	awaitPipeline(t, w.pendingInserts[0].done)
	requirePipelineRoute(t, w, "history_ledgers", "json-each-row", count, EncoderRowBytes{}, EncoderRowBytes{}, EncoderRowBytes{})
	if err := w.WaitPending(context.Background()); err != nil {
		t.Fatal(err)
	}
	requirePipelineRoute(t, w, "history_ledgers", "json-each-row", count, count, EncoderRowBytes{}, count)
	if w.DatasetWriteStats().Rows != 1 || w.DatasetWriteStats().Chunks != 1 {
		t.Fatal("joined request lost acknowledgement")
	}
}

func TestEncoderRouteCancellationBeforePermitAndInRequest(t *testing.T) {
	t.Run("before admission", func(t *testing.T) {
		var capture effectsTestCapture
		w := nativeTestWriter(t, false, false, 2, 10, 0, &capture)
		if err := pipelineEmit(w, context.Background(), 1); err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if err := w.Flush(ctx); !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
		count := EncoderRowBytes{Rows: 1, JSONBytes: routePipelineBytes(t, w, map[string]any{"id": 1}, 0)}
		requirePipelineRoute(t, w, "history_ledgers", "json-each-row", count, EncoderRowBytes{}, EncoderRowBytes{}, EncoderRowBytes{})
		if len(capture.calls) != 0 || len(w.pendingInserts) != 0 || w.tables["history_ledgers"].bufferRows != 1 || w.tables["history_ledgers"].chunk != 0 {
			t.Fatal("cancelled admission detached or attempted buffered membership")
		}
	})
	t.Run("before permit", func(t *testing.T) {
		if len(datasetInsertPermits) != 0 {
			t.Fatal("prior test leaked dataset permit")
		}
		for range cap(datasetInsertPermits) {
			datasetInsertPermits <- struct{}{}
		}
		defer func() {
			for range cap(datasetInsertPermits) {
				<-datasetInsertPermits
			}
		}()
		w := nativeTestWriter(t, false, false, 2, 1, 0, effectsTestTransport(func(*http.Request) (*http.Response, error) {
			t.Error("permit-cancelled membership reached HTTP")
			return nil, context.Canceled
		}))
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		if err := pipelineEmit(w, ctx, 1); err != nil {
			t.Fatal(err)
		}
		cancel()
		if err := w.WaitPending(context.Background()); !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
		count := EncoderRowBytes{Rows: 1, JSONBytes: routePipelineBytes(t, w, map[string]any{"id": 1}, 0)}
		requirePipelineRoute(t, w, "history_ledgers", "json-each-row", count, EncoderRowBytes{}, count, EncoderRowBytes{})
	})
	for _, pending := range []int{0, 2} {
		t.Run(fmt.Sprintf("in request/pending=%d", pending), func(t *testing.T) {
			started := make(chan struct{}, 1)
			w := nativeTestWriter(t, false, false, pending, 1, 0, effectsTestTransport(func(r *http.Request) (*http.Response, error) {
				_, _ = io.Copy(io.Discard, r.Body)
				started <- struct{}{}
				<-r.Context().Done()
				return nil, r.Context().Err()
			}))
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan error, 1)
			go func() {
				err := pipelineEmit(w, ctx, 1)
				if err == nil {
					err = w.WaitPending(context.Background())
				}
				done <- err
			}()
			awaitPipeline(t, started)
			cancel()
			if err := awaitPipeline(t, done); !errors.Is(err, context.Canceled) {
				t.Fatal(err)
			}
			count := EncoderRowBytes{Rows: 1, JSONBytes: routePipelineBytes(t, w, map[string]any{"id": 1}, 0)}
			requirePipelineRoute(t, w, "history_ledgers", "json-each-row", count, count, count, EncoderRowBytes{})
			if w.DatasetWriteStats().Rows != 0 || w.DatasetWriteStats().Chunks != 0 || len(datasetInsertPermits) != 0 {
				t.Fatal("cancelled request acknowledged or leaked permit")
			}
		})
	}
}

func TestEncoderRouteFailedChunkLeavesBufferedRowUnattempted(t *testing.T) {
	started, release := make(chan struct{}, 2), make(chan struct{}, 2)
	defer close(release)
	w := nativeTestWriter(t, false, false, 2, 1, 0, effectsTestTransport(func(r *http.Request) (*http.Response, error) {
		_, _ = io.Copy(io.Discard, r.Body)
		started <- struct{}{}
		select {
		case <-release:
		case <-r.Context().Done():
			return nil, r.Context().Err()
		}
		response := effectsTestResponse()
		if strings.Contains(r.URL.Query().Get("param_token"), ":history_ledgers:1:") {
			response.StatusCode = http.StatusBadRequest
			response.Body = io.NopCloser(strings.NewReader("injected route failure"))
		}
		return response, nil
	}))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	for i := range 2 {
		if err := pipelineEmit(w, ctx, i); err != nil {
			t.Fatal(err)
		}
	}
	for range 2 {
		awaitPipeline(t, started)
	}
	w.limits.MaximumRows = 2
	if err := pipelineEmit(w, ctx, 2); err != nil {
		t.Fatal(err)
	}
	var sizes [3]uint64
	for i := range sizes {
		sizes[i] = routePipelineBytes(t, w, map[string]any{"id": i}, uint64(i))
	}
	release <- struct{}{}
	release <- struct{}{}
	if err := w.WaitPending(context.Background()); err == nil || !strings.Contains(err.Error(), "injected route failure") {
		t.Fatal(err)
	}
	requirePipelineRoute(t, w, "history_ledgers", "json-each-row",
		EncoderRowBytes{Rows: 3, JSONBytes: sizes[0] + sizes[1] + sizes[2]},
		EncoderRowBytes{Rows: 2, JSONBytes: sizes[0] + sizes[1]},
		EncoderRowBytes{Rows: 1, JSONBytes: sizes[1]}, EncoderRowBytes{Rows: 1, JSONBytes: sizes[0]})
	stats := w.DatasetWriteStats()
	if stats.Rows != 1 || stats.Chunks != 1 || stats.JSONBytes != sizes[0] || w.tables["history_ledgers"].bufferRows != 1 {
		t.Fatal("failed or buffered membership became acknowledged", stats)
	}
	if err := w.Flush(context.Background()); err == nil {
		t.Fatal("failed pending job lost before buffered flush")
	}
	if w.DatasetWriteStats().Rows != stats.Rows || w.DatasetWriteStats().Chunks != stats.Chunks {
		t.Fatal("unattempted buffered row was acknowledged")
	}
}

func TestEncoderRouteOversizeSynchronousFallback(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(fmt.Sprint(fail), func(t *testing.T) {
			calls := 0
			w := nativeTestWriter(t, false, false, 2, 1, 1, effectsTestTransport(func(r *http.Request) (*http.Response, error) {
				calls++
				body, err := io.ReadAll(r.Body)
				if err != nil || len(body) == 0 || !strings.Contains(r.URL.Query().Get("query"), "FORMAT JSONEachRow") || !strings.HasSuffix(r.URL.Query().Get("param_token"), ":history_ledgers:0:recovery:typed-effects-test") {
					t.Error("oversize fallback changed body, format or token", err)
				}
				response := effectsTestResponse()
				if fail {
					response.StatusCode = http.StatusBadRequest
					response.Body = io.NopCloser(strings.NewReader("oversize route failure"))
				}
				return response, nil
			}))
			err := pipelineEmit(w, context.Background(), 1)
			if (err != nil) != fail || (fail && !strings.Contains(err.Error(), "oversize route failure")) {
				t.Fatal("oversize fallback error changed", err)
			}
			count := EncoderRowBytes{Rows: 1, JSONBytes: routePipelineBytes(t, w, map[string]any{"id": 1}, 0)}
			failed, ack := EncoderRowBytes{}, count
			if fail {
				failed, ack = count, EncoderRowBytes{}
			}
			requirePipelineRoute(t, w, "history_ledgers", "json-each-row", count, count, failed, ack)
			stats := w.DatasetWriteStats()
			if calls != 1 || len(w.pendingInserts) != 0 || w.pendingInsertBytes != 0 || len(datasetInsertPermits) != 0 || stats.Rows != ack.Rows || stats.Chunks != ack.Rows || stats.JSONBytes != ack.JSONBytes {
				t.Fatal("oversize synchronous completion accounting changed", stats)
			}
		})
	}
}

func TestEncoderRouteFinishBlockFailureLeavesBufferedMembershipOfferedOnly(t *testing.T) {
	var capture effectsTestCapture
	w := nativeTestWriter(t, false, true, 2, 10, 0, &capture)
	row := nativeTableFixture()
	if err := w.Emit(context.Background(), "history_contract_events", 1, row); err != nil {
		t.Fatal(err)
	}
	table := w.tables["history_contract_events"]
	active := table.nativeBuffer.active
	active.Columns[0] = &effectsFailEncodingColumn{active.Columns[0]}
	if err := w.Flush(context.Background()); err == nil || !strings.Contains(err.Error(), "injected ordered Native encode failure") {
		t.Fatal("finish-block error changed", err)
	}
	count := EncoderRowBytes{Rows: 1, JSONBytes: routePipelineBytes(t, w, row, 0)}
	requirePipelineRoute(t, w, "history_contract_events", "typed-prepared", count, EncoderRowBytes{}, EncoderRowBytes{}, EncoderRowBytes{})
	if len(capture.calls) != 0 || len(w.pendingInserts) != 0 || table.bufferRows != 1 || table.chunk != 0 || w.DatasetWriteStats().Rows != 0 || w.DatasetWriteStats().Chunks != 0 {
		t.Fatal("finish-block failure became an attempted or acknowledged chunk")
	}
}

func TestEncoderRouteVirtualLedgerTransactionsStayOmitted(t *testing.T) {
	w := nativeTestWriter(t, false, false, 2, 1, 0, effectsTestTransport(func(*http.Request) (*http.Response, error) {
		t.Error("virtual row issued an HTTP call")
		return effectsTestResponse(), nil
	}))
	w.client.virtualLedgerTransactions = true
	if err := w.Emit(context.Background(), "ledger_transactions", 1, func() {}); err != nil {
		t.Fatal(err)
	}
	if err := w.EmitPrepared(context.Background(), "ledger_transactions", 1, nil); err != nil {
		t.Fatal(err)
	}
	if err := w.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	stats := w.DatasetWriteStats()
	if len(stats.EncoderRoutes) != 0 || stats.Rows != 0 || stats.Chunks != 0 || stats.JSONBytes != 0 || w.TotalRows() != 2 || w.ExpectedRows()["ledger_transactions"] != 2 {
		t.Fatalf("virtual rows were classified as serialized writes: %+v", stats)
	}
	if len(stats.OmittedDatasetRows) != 1 || stats.OmittedDatasetRows[0].Dataset != "ledger_transactions" || stats.OmittedDatasetRows[0].Rows != 2 {
		t.Fatal("omitted logical rows not recorded", stats.OmittedDatasetRows)
	}
}
