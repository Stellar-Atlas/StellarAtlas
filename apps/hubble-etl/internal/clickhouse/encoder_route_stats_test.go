package clickhouse

import (
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func TestEncoderRouteClassification(t *testing.T) {
	w := BatchWriter{limits: WriterLimits{TypedEffects: true}}
	for _, dataset := range encoderCatalogue.order {
		table := &tableBuffer{}
		got := w.offerEncoderRoute(dataset, table, []byte("{}"))
		want, known := encoderCatalogue.routes[dataset]
		if dataset == "history_effects" {
			want, known = encoderTypedJSONFallback, true
		}
		if known && (got != want || table.routeStats.totals[got].offered != (EncoderRowBytes{1, 3})) {
			t.Fatalf("classification differs for %s", dataset)
		}
	}
	table := &tableBuffer{nativePrepared: &PreparedNativeRow{}}
	if got := w.offerEncoderRoute("history_effects", table, nil); got != encoderTypedPrepared {
		t.Fatal(got)
	}
	if got := w.offerEncoderRoute("unknown", table, nil); got != encoderRouteCount {
		t.Fatal("unknown dataset classified")
	}
}

func TestEncoderRouteMembershipAndSaturation(t *testing.T) {
	table := &tableBuffer{}
	w := BatchWriter{tables: map[string]*tableBuffer{"history_operations": table}}
	route := w.offerEncoderRoute("history_operations", table, []byte("{}"))
	table.routeStats.accept(route, 3)
	w.mergeEncoderChunk("history_operations", table.routeStats.chunk, false, errors.New("cancelled"))
	total := &table.routeStats.totals[route]
	if total.attempted.Rows != 0 || total.failed.Rows != 1 || total.acknowledged.Rows != 0 {
		t.Fatal("cancelled membership differs")
	}
	w.mergeEncoderChunk("history_operations", table.routeStats.chunk, true, nil)
	if total.attempted != (EncoderRowBytes{1, 3}) || total.acknowledged != (EncoderRowBytes{1, 3}) {
		t.Fatal("ACK membership differs")
	}
	table.routeStats.reject(route, 3)
	if total.failed.Rows != 2 {
		t.Fatal("rejection missing")
	}
	total.offered = EncoderRowBytes{^uint64(0), ^uint64(0)}
	w.offerEncoderRoute("history_operations", table, []byte("{}"))
	if !total.overflow || total.offered.Rows != ^uint64(0) || total.offered.JSONBytes != ^uint64(0) {
		t.Fatal("overflow wrapped")
	}
	table.routeStats.chunk[route] = EncoderRowBytes{^uint64(0), ^uint64(0)}
	table.routeStats.accept(route, 3)
	if table.routeStats.chunk[route].Rows != ^uint64(0) || !total.overflow {
		t.Fatal("chunk overflow lost")
	}
	w.mergeEncoderChunk("not-present", table.routeStats.chunk, true, nil)
	if len(w.tables) != 1 {
		t.Fatal("merge allocated dataset")
	}
}

func TestEncoderRouteSnapshotOrderAndOwnership(t *testing.T) {
	w := BatchWriter{tables: make(map[string]*tableBuffer)}
	for i := len(encoderCatalogue.order) - 1; i >= 0; i-- {
		name := encoderCatalogue.order[i]
		table := &tableBuffer{}
		for route := encoderRoute(0); route < encoderRouteCount; route++ {
			table.routeStats.totals[route].offered = EncoderRowBytes{1, 2}
		}
		w.tables[name] = table
	}
	got := w.encoderRouteStats()
	if len(got) != len(encoderCatalogue.order)*int(encoderRouteCount) {
		t.Fatal("unexpected snapshot count")
	}
	for i, entry := range got {
		if entry.Dataset != encoderCatalogue.order[i/int(encoderRouteCount)] || entry.Route != encoderRouteNames[i%int(encoderRouteCount)] {
			t.Fatal("catalogue order changed")
		}
	}
	got[0].Offered.Rows = 999
	if w.encoderRouteStats()[0].Offered.Rows != 1 {
		t.Fatal("snapshot aliases writer")
	}
	w.tables["ledger_transactions"].routeStats.virtualRows = 7
	w.tables["unknown"] = &tableBuffer{routeStats: encoderTableStats{virtualRows: 99}}
	if len(w.encoderRouteStats()) != len(got) {
		t.Fatal("unknown label escaped catalogue")
	}
	omitted := w.omittedDatasetRows()
	if len(omitted) != 1 || omitted[0].Rows != 7 {
		t.Fatal("virtual rows omitted incorrectly")
	}
	omitted[0].Rows = 99
	if w.omittedDatasetRows()[0].Rows != 7 {
		t.Fatal("omitted snapshot aliases writer")
	}
	virtual := &tableBuffer{routeStats: encoderTableStats{virtualRows: 3}}
	onlyVirtual := BatchWriter{tables: map[string]*tableBuffer{"ledger_transactions": virtual}}
	if len(onlyVirtual.encoderRouteStats()) != 0 || len(onlyVirtual.omittedDatasetRows()) != 1 {
		t.Fatal("virtual rows invented serialized route bytes")
	}
}

func TestEncoderRouteCombinedSummaryBound(t *testing.T) {
	w := BatchWriter{tables: make(map[string]*tableBuffer), insertByDataset: make(map[string]insertTimings)}
	maximum := ^uint64(0)
	metric := responseMetricTotals{known: maximum, unknown: maximum, total: maximum}
	for _, name := range encoderCatalogue.order {
		table := &tableBuffer{}
		route := encoderCatalogue.routes[name]
		put := func(route encoderRoute) {
			pair := EncoderRowBytes{maximum, maximum}
			table.routeStats.totals[route] = encoderRouteTotals{pair, pair, pair, pair, true}
		}
		if name == "history_effects" || name == "history_contract_events" || name == "history_operations" {
			put(encoderTypedPrepared)
			put(encoderTypedJSONFallback)
		} else {
			put(route)
		}
		w.tables[name] = table
		w.insertByDataset[name] = insertTimings{
			responses:    insertResponseTotals{calls: maximum, failed: maximum, elapsedNanoseconds: metric, writtenRows: metric, writtenBytes: metric},
			nativeEncode: time.Duration(1<<63 - 1), request: time.Duration(1<<63 - 1), poolWait: time.Duration(1<<63 - 1), upload: time.Duration(1<<63 - 1), firstByteWait: time.Duration(1<<63 - 1), bodyRead: time.Duration(1<<63 - 1), permitWait: time.Duration(1<<63 - 1),
		}
	}
	w.tables["ledger_transactions"].routeStats.virtualRows = maximum
	w.flushedRows, w.flushedChunks, w.flushedJSONBytes = maximum, maximum, maximum
	stats := w.DatasetWriteStats()
	// Exercise full signed field width conservatively, even though converting a
	// time.Duration to milliseconds normally produces fewer digits.
	maxDuration := int64(1<<63 - 1)
	stats.FlushMilliseconds, stats.NativeEncodeMilliseconds = maxDuration, maxDuration
	stats.RequestMilliseconds, stats.PoolWaitMilliseconds = maxDuration, maxDuration
	stats.UploadMilliseconds, stats.FirstByteWaitMilliseconds = maxDuration, maxDuration
	stats.BodyReadMilliseconds, stats.PermitWaitMilliseconds = maxDuration, maxDuration
	stats.PendingJoinMilliseconds = maxDuration
	encoded, err := json.Marshal(stats)
	if err != nil {
		t.Fatal(err)
	}
	if len(encoded) > 24<<10 {
		t.Fatalf("combined summary %d bytes exceeds 24 KiB", len(encoded))
	}
	t.Logf("maximum-width full dataset summary: %d bytes", len(encoded))
}
