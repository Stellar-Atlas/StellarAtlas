package clickhouse

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/schema"
)

func responseValue(value uint64) *uint64 { return &value }

func TestInsertResponseMetricCoverage(t *testing.T) {
	for _, tc := range []struct {
		name           string
		values         []*uint64
		known, unknown uint64
		want           *uint64
	}{
		{"absent", nil, 0, 0, nil},
		{"unknown", []*uint64{nil}, 0, 1, nil},
		{"valid-zero", []*uint64{responseValue(0)}, 1, 0, responseValue(0)},
		{"mixed", []*uint64{nil, responseValue(0), responseValue(7), nil}, 2, 2, responseValue(7)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var metric responseMetricTotals
			for _, value := range tc.values {
				metric.observe(value)
			}
			got := metric.snapshot()
			if got.KnownResponses != tc.known || got.UnknownResponses != tc.unknown || got.Overflow || !reflect.DeepEqual(got.ObservedTotal, tc.want) {
				t.Fatalf("unexpected metric: %+v", got)
			}
			encoded, err := json.Marshal(got)
			if err != nil {
				t.Fatal(err)
			}
			if tc.want == nil && !strings.Contains(string(encoded), `"observedTotal":null`) {
				t.Fatal("unknown total must be JSON null")
			}
		})
	}
}

func TestInsertResponseOverflowAndMerge(t *testing.T) {
	var first, second insertResponseTotals
	first.observe(insertResponseMetadata{elapsedNanoseconds: responseValue(^uint64(0)), writtenRows: responseValue(0)}, false)
	second.observe(insertResponseMetadata{elapsedNanoseconds: responseValue(1), writtenBytes: responseValue(9)}, true)
	first.add(second)
	if first.calls != 2 || first.failed != 1 {
		t.Fatal("call accounting changed")
	}
	if got := first.elapsedNanoseconds.snapshot(); !got.Overflow || got.ObservedTotal != nil || got.KnownResponses != 2 {
		t.Fatalf("sum overflow wrapped: %+v", got)
	}
	if got := first.writtenRows.snapshot(); got.KnownResponses != 1 || got.UnknownResponses != 1 || got.ObservedTotal == nil || *got.ObservedTotal != 0 {
		t.Fatalf("zero/unknown merge: %+v", got)
	}
	if got := first.writtenBytes.snapshot(); got.KnownResponses != 1 || got.UnknownResponses != 1 || got.ObservedTotal == nil || *got.ObservedTotal != 9 {
		t.Fatalf("mixed bytes: %+v", got)
	}
	first.observe(insertResponseMetadata{elapsedNanoseconds: responseValue(0)}, false)
	var copied insertResponseTotals
	copied.add(first)
	if got := copied.elapsedNanoseconds.snapshot(); !got.Overflow || got.ObservedTotal != nil {
		t.Fatal("overflow must remain sticky after observe/add")
	}
	var direct responseMetricTotals
	direct.observe(responseValue(^uint64(0)))
	direct.observe(responseValue(1))
	if got := direct.snapshot(); !got.Overflow || got.ObservedTotal != nil {
		t.Fatal("observe overflow was not rejected")
	}
	count := responseMetricTotals{known: ^uint64(0)}
	count.observe(responseValue(0))
	if got := count.snapshot(); got.KnownResponses != ^uint64(0) || !got.Overflow || got.ObservedTotal != nil {
		t.Fatal("response counter wrapped")
	}
}

func TestInsertResponseCatalogOrderAndBound(t *testing.T) {
	var writer BatchWriter
	for i := len(insertResponseDatasets.order) - 1; i >= 0; i-- {
		var timing insertTimings
		timing.responses.observe(insertResponseMetadata{}, false)
		timing.nativeEncode, timing.request, timing.poolWait = time.Millisecond, 2*time.Millisecond, 3*time.Millisecond
		timing.upload, timing.firstByteWait, timing.bodyRead, timing.permitWait = 4*time.Millisecond, 5*time.Millisecond, 6*time.Millisecond, 7*time.Millisecond
		writer.mergeInsertTimings(insertResponseDatasets.order[i], timing)
	}
	var unknown insertTimings
	unknown.responses.observe(insertResponseMetadata{}, true)
	writer.mergeInsertTimings("untrusted/raw/query", unknown)
	writer.mergeInsertTimings("accounts", insertTimings{request: time.Second})
	stats := writer.datasetInsertResponseStats()
	if len(stats) != len(schema.Datasets()) || len(writer.insertByDataset) != len(schema.Datasets()) {
		t.Fatal("dataset map/output is not catalog bounded")
	}
	if _, found := writer.insertByDataset["untrusted/raw/query"]; found {
		t.Fatal("unknown dataset retained")
	}
	encoded, err := json.Marshal(writer.DatasetWriteStats())
	if err != nil || len(encoded) > 24<<10 || strings.Contains(string(encoded), "untrusted/raw/query") {
		t.Fatal("dataset response summary exceeded its finite output bound or leaked an unknown key")
	}
	for i, item := range stats {
		if item.Dataset != insertResponseDatasets.order[i] || item.Calls != 1 || item.FailedCalls != 0 || item.RequestMilliseconds != 2 || item.NativeEncodeMilliseconds != 1 || item.PoolWaitMilliseconds != 3 || item.UploadMilliseconds != 4 || item.FirstByteWaitMilliseconds != 5 || item.BodyReadMilliseconds != 6 || item.PermitWaitMilliseconds != 7 {
			t.Fatalf("order/phase mismatch: %+v", item)
		}
	}
	if writer.insertTimings.responses.calls != uint64(len(stats)+1) || writer.insertTimings.responses.failed != 1 || writer.insertTimings.request != time.Duration(len(stats))*2*time.Millisecond+time.Second {
		t.Fatal("global merge must happen before per-dataset filtering")
	}
	var untouched BatchWriter
	untouched.mergeInsertTimings("accounts", insertTimings{request: time.Second})
	if len(untouched.datasetInsertResponseStats()) != 0 || untouched.insertByDataset != nil {
		t.Fatal("duration-only merge created a touched dataset")
	}
}

func TestInsertResponseSnapshotsDetached(t *testing.T) {
	value := uint64(7)
	var timing insertTimings
	timing.responses.observe(insertResponseMetadata{elapsedNanoseconds: &value, writtenRows: &value, writtenBytes: &value}, false)
	var writer BatchWriter
	writer.mergeInsertTimings("accounts", timing)
	first := writer.datasetInsertResponseStats()
	value = 999
	*first[0].ReportedElapsedNanoseconds.ObservedTotal = 333
	if *first[0].ReportedWrittenRows.ObservedTotal != 7 {
		t.Fatal("metric pointers alias")
	}
	second := writer.datasetInsertResponseStats()
	if *second[0].ReportedElapsedNanoseconds.ObservedTotal != 7 {
		t.Fatal("snapshot/input mutation changed accumulator")
	}
	writer.mergeInsertTimings("accounts", timing)
	if *second[0].ReportedElapsedNanoseconds.ObservedTotal != 7 || *writer.datasetInsertResponseStats()[0].ReportedElapsedNanoseconds.ObservedTotal != 14 {
		t.Fatal("future merge mutated previous snapshot")
	}
}
