package clickhouse

import "github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/schema"

// ResponseMetricStats reports only observed response metadata, not measured work.
// A missing value is unknown; a reported zero is a known observation.
// Headers can precede query completion: totals are not CPU, commit or disk I/O.
type ResponseMetricStats struct {
	KnownResponses   uint64  `json:"knownResponses"`
	UnknownResponses uint64  `json:"unknownResponses"`
	ObservedTotal    *uint64 `json:"observedTotal"`
	Overflow         bool    `json:"overflow"`
}

type responseMetricTotals struct {
	known, unknown, total uint64
	overflow              bool
}

func responseSum(a, b uint64) (uint64, bool) {
	if ^uint64(0)-a < b {
		return ^uint64(0), true
	}
	return a + b, false
}

func (m *responseMetricTotals) observe(value *uint64) {
	if value == nil {
		var overflow bool
		m.unknown, overflow = responseSum(m.unknown, 1)
		m.overflow = m.overflow || overflow
		return
	}
	var countOverflow, totalOverflow bool
	m.known, countOverflow = responseSum(m.known, 1)
	m.total, totalOverflow = responseSum(m.total, *value)
	m.overflow = m.overflow || countOverflow || totalOverflow
}

func (m *responseMetricTotals) add(other responseMetricTotals) {
	var knownOverflow, unknownOverflow, totalOverflow bool
	m.known, knownOverflow = responseSum(m.known, other.known)
	m.unknown, unknownOverflow = responseSum(m.unknown, other.unknown)
	m.total, totalOverflow = responseSum(m.total, other.total)
	m.overflow = m.overflow || other.overflow || knownOverflow || unknownOverflow || totalOverflow
}

func (m responseMetricTotals) snapshot() ResponseMetricStats {
	result := ResponseMetricStats{KnownResponses: m.known, UnknownResponses: m.unknown, Overflow: m.overflow}
	if m.known > 0 && !m.overflow {
		total := m.total
		result.ObservedTotal = &total
	}
	return result
}

type insertResponseTotals struct {
	calls, failed      uint64
	elapsedNanoseconds responseMetricTotals
	writtenRows        responseMetricTotals
	writtenBytes       responseMetricTotals
}

func (t *insertResponseTotals) observe(metadata insertResponseMetadata, failed bool) {
	t.calls, _ = responseSum(t.calls, 1)
	if failed {
		t.failed, _ = responseSum(t.failed, 1)
	}
	t.elapsedNanoseconds.observe(metadata.elapsedNanoseconds)
	t.writtenRows.observe(metadata.writtenRows)
	t.writtenBytes.observe(metadata.writtenBytes)
}

func (t *insertResponseTotals) add(other insertResponseTotals) {
	t.calls, _ = responseSum(t.calls, other.calls)
	t.failed, _ = responseSum(t.failed, other.failed)
	t.elapsedNanoseconds.add(other.elapsedNanoseconds)
	t.writtenRows.add(other.writtenRows)
	t.writtenBytes.add(other.writtenBytes)
}

// DatasetInsertResponseStats excludes metadata queries and per-writer join time.
// Phase durations overlap: they are not additive server or wall-clock timings.
type DatasetInsertResponseStats struct {
	Dataset                    string              `json:"dataset"`
	Calls                      uint64              `json:"calls"`
	FailedCalls                uint64              `json:"failedCalls"`
	ReportedElapsedNanoseconds ResponseMetricStats `json:"reportedElapsedNanoseconds"`
	ReportedWrittenRows        ResponseMetricStats `json:"reportedWrittenRows"`
	ReportedWrittenBytes       ResponseMetricStats `json:"reportedWrittenBytes"`
	NativeEncodeMilliseconds   int64               `json:"nativeEncodeMilliseconds"`
	RequestMilliseconds        int64               `json:"requestMilliseconds"`
	PoolWaitMilliseconds       int64               `json:"poolWaitMilliseconds"`
	UploadMilliseconds         int64               `json:"uploadMilliseconds"`
	FirstByteWaitMilliseconds  int64               `json:"firstByteWaitMilliseconds"`
	BodyReadMilliseconds       int64               `json:"bodyReadMilliseconds"`
	PermitWaitMilliseconds     int64               `json:"permitWaitMilliseconds"`
}

var insertResponseDatasets = func() struct {
	order   []string
	allowed map[string]bool
} {
	result := struct {
		order   []string
		allowed map[string]bool
	}{allowed: make(map[string]bool)}
	for _, dataset := range schema.Datasets() {
		result.order = append(result.order, dataset.Name)
		result.allowed[dataset.Name] = true
	}
	return result
}()

// The ordered writer alone merges completed timing records. Unknown names can
// affect global totals but never allocate a per-dataset key or appear in output.
func (w *BatchWriter) mergeInsertTimings(dataset string, other insertTimings) {
	w.insertTimings.add(other)
	if other.responses.calls == 0 || !insertResponseDatasets.allowed[dataset] {
		return
	}
	if w.insertByDataset == nil {
		w.insertByDataset = make(map[string]insertTimings)
	}
	current := w.insertByDataset[dataset]
	current.add(other)
	w.insertByDataset[dataset] = current
}

func (w *BatchWriter) datasetInsertResponseStats() []DatasetInsertResponseStats {
	result := make([]DatasetInsertResponseStats, 0, len(insertResponseDatasets.order))
	for _, dataset := range insertResponseDatasets.order {
		timing, found := w.insertByDataset[dataset]
		if !found || timing.responses.calls == 0 {
			continue
		}
		result = append(result, DatasetInsertResponseStats{
			Dataset: dataset, Calls: timing.responses.calls, FailedCalls: timing.responses.failed,
			ReportedElapsedNanoseconds: timing.responses.elapsedNanoseconds.snapshot(),
			ReportedWrittenRows:        timing.responses.writtenRows.snapshot(),
			ReportedWrittenBytes:       timing.responses.writtenBytes.snapshot(),
			NativeEncodeMilliseconds:   timing.nativeEncode.Milliseconds(),
			RequestMilliseconds:        timing.request.Milliseconds(),
			PoolWaitMilliseconds:       timing.poolWait.Milliseconds(),
			UploadMilliseconds:         timing.upload.Milliseconds(),
			FirstByteWaitMilliseconds:  timing.firstByteWait.Milliseconds(),
			BodyReadMilliseconds:       timing.bodyRead.Milliseconds(),
			PermitWaitMilliseconds:     timing.permitWait.Milliseconds(),
		})
	}
	return result
}
