package clickhouse

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	chproto "github.com/ClickHouse/ch-go/proto"
	"github.com/ClickHouse/clickhouse-go/v2/lib/column"
	native "github.com/ClickHouse/clickhouse-go/v2/lib/proto"
	"github.com/guregu/null"
	"github.com/stellar/stellar-etl/v2/internal/transform"
)

type effectsTestTransport func(*http.Request) (*http.Response, error)

func (f effectsTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func effectsTestResponse() *http.Response {
	return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("")), Header: http.Header{}}
}

var effectsTestAt = time.Date(2026, 10, 30, 0, 0, 0, 123456789, time.UTC)

func effectsTestWriter(t *testing.T, typed bool, pending, maxRows, budget int, transport http.RoundTripper) *BatchWriter {
	return nativeTestWriter(t, typed, false, pending, maxRows, budget, transport)
}
func nativeTestWriter(t *testing.T, effects, events bool, pending, maxRows, budget int, transport http.RoundTripper) *BatchWriter {
	t.Helper()
	client, err := New(Config{Endpoint: "http://offline.invalid", Database: "effects_test", HTTPClient: &http.Client{Transport: transport}})
	if err != nil {
		t.Fatal(err)
	}
	w, err := NewBatchWriter(client, BatchIdentity{ID: "6918e5c8-7d82-4f08-a4b6-84a7c338faa8", SourceSHA256: strings.Repeat("a", 64), StartLedger: 1, EndLedger: math.MaxUint32}, WriterLimits{TypedEffects: effects, TypedEvents: events, MaximumRows: maxRows, MaximumBytes: 256 << 20, MaximumPendingInserts: pending, MaximumPendingInsertBytes: budget, RecoveryNamespace: "typed-effects-test", RecoveryIngestedAt: effectsTestAt})
	if err != nil {
		t.Fatal(err)
	}
	return w
}

type effectsTestCall struct {
	query, token string
	body         []byte
}
type effectsTestCapture struct {
	sync.Mutex
	calls []effectsTestCall
}

func (c *effectsTestCapture) RoundTrip(r *http.Request) (*http.Response, error) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, err
	}
	c.Lock()
	c.calls = append(c.calls, effectsTestCall{r.URL.Query().Get("query"), r.URL.Query().Get("param_token"), body})
	c.Unlock()
	return effectsTestResponse(), nil
}
func effectsTestBlocks(t *testing.T, body []byte) [][][]any {
	t.Helper()
	reader := chproto.NewReader(bytes.NewReader(body))
	var blocks [][][]any
	for {
		b := native.NewBlock()
		b.ServerContext.Timezone = time.UTC
		err := b.Decode(reader, 0)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		rows := make([][]any, b.Rows())
		for r := range rows {
			rows[r] = make([]any, len(b.Columns))
			for c := range b.Columns {
				rows[r][c] = b.Columns[c].Row(r, false)
			}
		}
		blocks = append(blocks, rows)
	}
	return blocks
}
func effectsTestCompare(t *testing.T, a, b []effectsTestCall, typed bool) {
	t.Helper()
	sort.Slice(a, func(i, j int) bool { return a[i].token < a[j].token })
	sort.Slice(b, func(i, j int) bool { return b[i].token < b[j].token })
	if len(a) != len(b) {
		t.Fatal("chunk count differs", len(a), len(b))
	}
	for i := range a {
		if a[i].query != b[i].query {
			t.Fatal("query changed")
		}
		want := a[i].token
		if typed {
			suffix := ":typed-effects-native-v1"
			if strings.Contains(a[i].query, "history_contract_events") {
				suffix = ":typed-events-native-v1"
			}
			want = strings.TrimSuffix(want, ":native-v1") + suffix
		}
		if b[i].token != want {
			t.Fatal("token changed", b[i].token, want)
		}
		if !reflect.DeepEqual(effectsTestBlocks(t, a[i].body), effectsTestBlocks(t, b[i].body)) {
			t.Fatal("Native semantics/types/order/block boundaries differ", i)
		}
	}
}
func TestTypedEffectsMixedSerialPreparedParity(t *testing.T) {
	for _, pending := range []int{0, 2} {
		var baseline, typed effectsTestCapture
		for _, enabled := range []bool{false, true} {
			capture := &baseline
			if enabled {
				capture = &typed
			}
			w := effectsTestWriter(t, enabled, pending, 3, 0, capture)
			for i := 0; i < 11; i++ {
				effect := transform.EffectOutput{Address: "GABC<>&", AddressMuxed: null.StringFrom(""), OperationID: int64(i), LedgerSequence: 2, EffectIndex: uint32(i), LedgerClosed: effectsTestAt, Details: map[string]any{"int": int64(math.MinInt64), "uint": uint64(math.MaxUint64), "string": "001", "array": []any{nil, true, 1.25, "1"}}}
				var row any = effect
				if i == 8 {
					effect.Address = string([]byte{255})
					row = effect
				}
				if i == 9 {
					row = map[string]any{"address": "fallback", "operation_id": 9, "details": map[string]any{"string": "1"}}
				}
				if i == 7 {
					effect.LedgerClosed = time.Date(2024, 1, 2, 3, 4, 5, 0, time.FixedZone("offset-seconds", 3661))
					row = effect
				}
				if i == 10 {
					row = &effect
				}
				var err error
				if i%3 == 0 {
					err = w.Emit(context.Background(), "history_effects", 2, row)
				} else {
					var body []byte
					body, err = w.PrepareRow("history_effects", row)
					if err == nil {
						if enabled && i%3 == 1 {
							var p *PreparedEffectsRow
							p, err = w.PrepareEffectsRow(row)
							if err == nil {
								err = w.EmitPreparedEffects(context.Background(), 2, body, p)
							}
						} else {
							err = w.EmitPrepared(context.Background(), "history_effects", 2, body)
						}
					}
				}
				if err != nil {
					t.Fatal(err)
				}
			}
			if err := w.Flush(context.Background()); err != nil {
				t.Fatal(err)
			}
			if w.TotalRows() != 11 || w.DatasetWriteStats().Rows != 11 || w.DatasetWriteStats().Chunks != 4 {
				t.Fatal(w.DatasetWriteStats())
			}
		}
		effectsTestCompare(t, baseline.calls, typed.calls, true)
	}
}
func TestTypedEffectsPreparedImmutableAndFallback(t *testing.T) {
	var baseline, typed effectsTestCapture
	for _, enabled := range []bool{false, true} {
		capture := &baseline
		if enabled {
			capture = &typed
		}
		w := effectsTestWriter(t, enabled, 2, 250000, 0, capture)
		nested := []any{"original", map[string]any{"key": "001"}}
		effect := transform.EffectOutput{Details: map[string]any{"nested": nested}}
		body, err := w.PrepareRow("history_effects", effect)
		if err != nil {
			t.Fatal(err)
		}
		p, err := w.PrepareEffectsRow(effect)
		if err != nil {
			t.Fatal(err)
		}
		if enabled && (p == nil || p.RetainedBytes() < len(body)) {
			t.Fatal("missing retained weight")
		}
		nested[0] = "mutated"
		nested[1].(map[string]any)["key"] = "changed"
		effect.Details["extra"] = 123
		if err = w.EmitPreparedEffects(context.Background(), 1, body, p); err != nil {
			t.Fatal(err)
		}
		if err = w.Flush(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	effectsTestCompare(t, baseline.calls, typed.calls, true)
	for _, bad := range []json.RawMessage{json.RawMessage(`{"unknown":1}`), json.RawMessage(`{"operation_id":"bad"}`), json.RawMessage(`{"details":`)} {
		var capture effectsTestCapture
		w := effectsTestWriter(t, true, 2, 250000, 0, &capture)
		if err := w.Emit(context.Background(), "history_effects", 1, transform.EffectOutput{}); err != nil {
			t.Fatal(err)
		}
		if err := w.EmitPrepared(context.Background(), "history_effects", 1, bad); err == nil {
			t.Fatal("bad row accepted")
		}
		if err := w.Flush(context.Background()); err == nil {
			t.Fatal("failed batch flushed")
		}
		if len(capture.calls) != 0 || w.DatasetWriteStats().Rows != 0 {
			t.Fatal("malformed block sent")
		}
	}
}
func TestTypedEffectsBlockLimitsAndOtherDataset(t *testing.T) {
	for _, tc := range []struct {
		rows, old, next int
		split           bool
	}{{32767, 1, 1, false}, {32768, 1, 1, true}, {1, nativeParallelBytes - 1, 1, false}, {1, nativeParallelBytes - 1, 2, true}, {0, 0, nativeParallelBytes + 1, false}} {
		if typedNativeBlockSplit(tc.rows, tc.old, tc.next) != tc.split {
			t.Fatal(tc)
		}
	}
	var capture effectsTestCapture
	w := effectsTestWriter(t, true, 0, 250000, 0, &capture)
	for i := 0; i < 32769; i++ {
		if err := w.Emit(context.Background(), "history_effects", 1, transform.EffectOutput{OperationID: int64(i)}); err != nil {
			t.Fatal(err)
		}
	}
	table := w.tables["history_effects"]
	segments := splitNativeJSONRows(table.body.Bytes(), nativeParallelRows, nativeParallelBytes)
	if len(segments) != 2 || len(table.nativeBuffer.blocks) != 1 || len(effectsTestBlocks(t, table.nativeBuffer.blocks[0])[0]) != 32768 || table.nativeBuffer.active.Rows() != 1 {
		t.Fatal("row block boundaries changed")
	}
	legacy, err := encodeNativeRowsParallel(typedEffectsColumns, table.body.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if err := w.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(effectsTestBlocks(t, capture.calls[0].body)) != 2 {
		t.Fatal("Native block count changed")
	}
	if !bytes.Equal(legacy, capture.calls[0].body) {
		t.Fatal("scalar-only multiblock Native bytes differ")
	}
	var calls [2]effectsTestCapture
	for i, enabled := range []bool{false, true} {
		writer := effectsTestWriter(t, enabled, 0, 1, 0, &calls[i])
		if err := writer.Emit(context.Background(), "history_ledgers", 1, map[string]any{"id": 1}); err != nil {
			t.Fatal(err)
		}
	}
	if !reflect.DeepEqual(calls[0].calls, calls[1].calls) {
		t.Fatal("other dataset changed")
	}
}

type effectsFailEncodingColumn struct{ column.Interface }

func (c *effectsFailEncodingColumn) ReadStatePrefix(*chproto.Reader) error { return nil }
func (c *effectsFailEncodingColumn) WriteStatePrefix(*chproto.Buffer) error {
	return errors.New("injected ordered Native encode failure")
}
func TestTypedEffectsOrderedEncodingError(t *testing.T) {
	var capture effectsTestCapture
	w := effectsTestWriter(t, true, 2, 250000, 0, &capture)
	if err := w.Emit(context.Background(), "history_effects", 1, transform.EffectOutput{}); err != nil {
		t.Fatal(err)
	}
	active := w.tables["history_effects"].nativeBuffer.active
	active.Columns[0] = &effectsFailEncodingColumn{active.Columns[0]}
	if err := w.Flush(context.Background()); err == nil {
		t.Fatal("ordered Native error lost")
	}
	elapsed := w.insertTimings.nativeEncode
	if err := w.Flush(context.Background()); err == nil {
		t.Fatal("failed block retried")
	}
	if len(capture.calls) != 0 || w.DatasetWriteStats().Rows != 0 || w.insertTimings.nativeEncode != elapsed || len(datasetInsertPermits) != 0 {
		t.Fatal("failed block posted or encoding counted twice")
	}
}
func TestTypedEffectsEncodedChunkQueueGeometry(t *testing.T) {
	started := make(chan struct{}, 2)
	release := make(chan struct{})
	transport := effectsTestTransport(func(r *http.Request) (*http.Response, error) {
		started <- struct{}{}
		<-release
		_, err := io.Copy(io.Discard, r.Body)
		return effectsTestResponse(), err
	})
	w := effectsTestWriter(t, true, 2, 250000, 512<<20, transport)
	for i := 0; i < 32769; i++ {
		if err := w.Emit(context.Background(), "history_effects", 1, transform.EffectOutput{OperationID: int64(i)}); err != nil {
			t.Fatal(err)
		}
	}
	table := w.tables["history_effects"]
	jsonCap := table.body.Cap()
	if len(table.nativeBuffer.blocks) != 1 || table.nativeBuffer.active == nil || table.nativeBuffer.active.Rows() != 1 {
		t.Fatal("more than one expanded block retained")
	}
	done := make(chan error, 1)
	go func() { done <- w.flushTable(context.Background(), "history_effects", table) }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("encoded chunk became artificial synchronous oversize")
	}
	<-started
	chunk := w.pendingInserts[0].native
	sum := 0
	for _, body := range chunk.blocks {
		sum += len(body)
	}
	expected := max(jsonCap, 2*sum+8192*(len(chunk.blocks)+1))
	if len(chunk.blocks) != 2 || w.pendingInsertBytes != expected || table.nativeBuffer != nil || table.body.Cap() != 0 {
		t.Fatal("immutable encoded payload/reservation/detachment differs")
	}
	w.limits.MaximumRows = 1
	if err := w.Emit(context.Background(), "history_effects", 1, transform.EffectOutput{}); err != nil {
		t.Fatal(err)
	}
	<-started
	if len(w.pendingInserts) != 2 {
		t.Fatal("typed chunks cannot overlap within512MiB")
	}
	close(release)
	if err := w.WaitPending(context.Background()); err != nil {
		t.Fatal(err)
	}
	if w.DatasetWriteStats().Rows != 32770 || w.DatasetWriteStats().Chunks != 2 || w.pendingInsertBytes != 0 {
		t.Fatal("typed queue acknowledgement accounting differs")
	}
}
func TestTypedEffectsExactJSONByteThreshold(t *testing.T) {
	var captures [2]effectsTestCapture
	var stats [2]DatasetWriteStats
	for i, enabled := range []bool{false, true} {
		w := effectsTestWriter(t, enabled, 2, 250000, 0, &captures[i])
		w.limits.MaximumBytes = 1024
		for n := 0; n < 5; n++ {
			row := transform.EffectOutput{Details: map[string]any{"pad": strings.Repeat("x", 256)}}
			if err := w.Emit(context.Background(), "history_effects", 1, row); err != nil {
				t.Fatal(err)
			}
		}
		if err := w.Flush(context.Background()); err != nil {
			t.Fatal(err)
		}
		stats[i] = w.DatasetWriteStats()
	}
	effectsTestCompare(t, captures[0].calls, captures[1].calls, true)
	if stats[0].Rows != stats[1].Rows || stats[0].Chunks != stats[1].Chunks || stats[0].JSONBytes != stats[1].JSONBytes {
		t.Fatal("original JSON stats/threshold changed")
	}
}
func TestTypedEffectsFailureCancelJoinAndBudget(t *testing.T) {
	for _, cancelled := range []bool{false, true} {
		started := make(chan struct{})
		ctx, cancel := context.WithCancel(context.Background())
		transport := effectsTestTransport(func(r *http.Request) (*http.Response, error) {
			close(started)
			if cancelled {
				<-r.Context().Done()
				return nil, r.Context().Err()
			}
			response := effectsTestResponse()
			response.StatusCode = 503
			return response, nil
		})
		w := effectsTestWriter(t, true, 2, 1, 0, transport)
		if err := w.Emit(ctx, "history_effects", 1, transform.EffectOutput{}); err != nil {
			t.Fatal(err)
		}
		<-started
		if cancelled {
			cancel()
		}
		if err := w.WaitPending(ctx); err == nil {
			t.Fatal("failure lost")
		}
		cancel()
		if len(w.pendingInserts) != 0 || w.pendingInsertBytes != 0 || w.DatasetWriteStats().Rows != 0 || len(datasetInsertPermits) != 0 {
			t.Fatal("jobs/permits/ack stats leaked")
		}
	}
	var capture effectsTestCapture
	w := effectsTestWriter(t, true, 2, 1, 1, &capture)
	if err := w.Emit(context.Background(), "history_effects", 1, transform.EffectOutput{}); err != nil {
		t.Fatal(err)
	}
	if len(w.pendingInserts) != 0 || w.DatasetWriteStats().Rows != 1 {
		t.Fatal("oversize typed chunk not synchronous")
	}
}
