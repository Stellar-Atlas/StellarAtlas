package clickhouse

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httptrace"
	"sync/atomic"
	"testing"
	"time"
)

func TestInsertRequestPhases(t *testing.T) {
	const body = "{\"ledger_sequence\":1}\n"
	const delay = 20 * time.Millisecond
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		payload, err := io.ReadAll(r.Body)
		if err != nil || string(payload) != body || r.URL.Query().Get("param_token") != "phase-test" {
			t.Errorf("INSERT payload/token changed: read error %v", err)
		}
		time.Sleep(delay)
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		time.Sleep(delay)
		_, _ = io.WriteString(w, "ok")
	}))
	defer server.Close()
	client, err := New(Config{Endpoint: server.URL, Database: "hubble", HTTPClient: server.Client()})
	if err != nil {
		t.Fatal(err)
	}
	var existing atomic.Int32
	ctx := httptrace.WithClientTrace(context.Background(), &httptrace.ClientTrace{
		GotFirstResponseByte: func() { existing.Add(1) },
	})
	var timings insertTimings
	if err := client.insert(ctx, "history_ledgers", "phase-test", []byte(body), &timings); err != nil {
		t.Fatal(err)
	}
	if existing.Load() != 1 {
		t.Fatal("existing trace was not preserved")
	}
	if timings.firstByteWait < delay/2 || timings.bodyRead < delay/2 {
		t.Fatalf("response phases missing: %+v", timings)
	}
	for name, value := range map[string]time.Duration{
		"pool": timings.poolWait, "upload": timings.upload,
		"firstByte": timings.firstByteWait, "body": timings.bodyRead,
	} {
		if value < 0 || value > timings.request {
			t.Fatalf("invalid %s phase %s of %s", name, value, timings.request)
		}
	}
}

func TestInsertTraceEarlyResponseAndRetry(t *testing.T) {
	request, err := http.NewRequest(http.MethodPost, "http://localhost", nil)
	if err != nil {
		t.Fatal(err)
	}
	var timings insertTimings
	request, finish := traceInsertRequest(request, &timings)
	trace := httptrace.ContextClientTrace(request.Context())
	trace.GetConn("localhost")
	trace.GotConn(httptrace.GotConnInfo{})
	trace.GotFirstResponseByte() // Response precedes upload completion.
	trace.WroteRequest(httptrace.WroteRequestInfo{})
	finish()
	if timings.firstByteWait != 0 {
		t.Fatalf("early response fabricated wait: %+v", timings)
	}
	trace.GetConn("late") // Closed snapshots ignore late transport callbacks.
	trace.GotConn(httptrace.GotConnInfo{})
	if timings.firstByteWait != 0 {
		t.Fatal("late callback changed snapshot")
	}

	request, finish = traceInsertRequest(request, &timings)
	trace = httptrace.ContextClientTrace(request.Context())
	trace.GetConn("localhost")
	trace.GotConn(httptrace.GotConnInfo{})
	trace.WroteRequest(httptrace.WroteRequestInfo{Err: io.ErrUnexpectedEOF})
	trace.GetConn("localhost") // Retry must discard the failed attempt's state.
	trace.GotConn(httptrace.GotConnInfo{})
	trace.WroteRequest(httptrace.WroteRequestInfo{})
	trace.GotFirstResponseByte()
	trace.GotFirstResponseByte() // A duplicate hook cannot double count.
	finish()
	if timings.poolWait < 0 || timings.upload < 0 || timings.firstByteWait < 0 {
		t.Fatalf("negative phase after retry: %+v", timings)
	}
}
