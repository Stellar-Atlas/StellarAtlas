package clickhouse

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPendingInsertFlushAndPromotionWaitForAcknowledgement(t *testing.T) {
	for _, promote := range []bool{false, true} {
		started, release := make(chan struct{}, 2), make(chan struct{})
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = io.Copy(io.Discard, r.Body)
			started <- struct{}{}
			<-release
		}))
		w := pipelineWriter(t, server, 2, 0)
		if err := pipelineEmit(w, context.Background(), 1); err != nil {
			t.Fatal(err)
		}
		awaitPipeline(t, started)
		done := make(chan error, 1)
		go func() {
			if promote {
				done <- w.PromoteHolderIndex(context.Background())
			} else {
				done <- w.Flush(context.Background())
			}
		}()
		pipelineBlocked(t, done)
		close(release)
		if err := awaitPipeline(t, done); err != nil {
			t.Fatal(err)
		}
		if w.flushedRows != 1 {
			t.Fatal("acknowledgement not merged")
		}
		server.Close()
	}
}

func TestPendingInsertFailureJoinsAndWithholdsPromotion(t *testing.T) {
	started, release := make(chan struct{}, 2), make(chan struct{})
	fail := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		if strings.HasSuffix(r.URL.Query().Get("param_token"), ":0") {
			<-fail
			http.Error(w, "injected failure", http.StatusBadRequest)
			return
		}
		started <- struct{}{}
		<-release
	}))
	defer server.Close()
	w := pipelineWriter(t, server, 2, 0)
	// Schedule two jobs before either result can be reaped.
	for row := range 2 {
		if err := pipelineEmit(w, context.Background(), row); err != nil {
			t.Fatal(err)
		}
	}
	close(fail)
	awaitPipeline(t, started)
	done := make(chan error, 1)
	go func() { done <- w.Flush(context.Background()) }()
	pipelineBlocked(t, done)
	close(release)
	if err := awaitPipeline(t, done); err == nil || !strings.Contains(err.Error(), "injected failure") {
		t.Fatal(err)
	}
	if len(w.pendingInserts) != 0 || w.flushedRows != 1 || len(datasetInsertPermits) != 0 {
		t.Fatal("error did not join or counted failed rows")
	}
	if err := w.PromoteHolderIndex(context.Background()); err == nil {
		t.Fatal("failure lost before promotion")
	}
	if err := w.Flush(context.Background()); err == nil {
		t.Fatal("failure lost before completion")
	}
}

func TestPendingInsertCancellationJoinsJobsAndPermitWaiters(t *testing.T) {
	started, release := make(chan struct{}, 10), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		started <- struct{}{}
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer server.Close()
	defer close(release)
	var writers []*BatchWriter
	for range 3 {
		w := pipelineWriter(t, server, 2, 0)
		writers = append(writers, w)
		for row := range 2 {
			if err := pipelineEmit(w, context.Background(), row); err != nil {
				t.Fatal(err)
			}
		}
	}
	for range 4 {
		awaitPipeline(t, started)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for _, w := range writers {
		if err := w.WaitPending(ctx); !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
		if len(w.pendingInserts) != 0 || w.pendingInsertBytes != 0 || w.flushedRows != 0 {
			t.Fatal("cancelled writer retains jobs or false acknowledgement")
		}
	}
	if len(datasetInsertPermits) != 0 {
		t.Fatal("cancelled jobs leaked permits")
	}
}

func TestPendingInsertCancelledEmitDoesNotDetach(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("cancelled emit sent a request") }))
	defer server.Close()
	w := pipelineWriter(t, server, 2, 0)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := pipelineEmit(w, ctx, 1); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if len(w.pendingInserts) != 0 || w.tables["history_ledgers"].chunk != 0 {
		t.Fatal("cancelled job detached")
	}
}

func TestPendingInsertFixedLatencyOverlapDemonstration(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		time.Sleep(20 * time.Millisecond)
	}))
	defer server.Close()
	for _, pending := range []int{0, 2} {
		w := pipelineWriter(t, server, pending, 0)
		start := time.Now()
		for row := range 4 {
			if err := pipelineEmit(w, context.Background(), row); err != nil {
				t.Fatal(err)
			}
		}
		if err := w.Flush(context.Background()); err != nil {
			t.Fatal(err)
		}
		t.Logf("localhost synthetic fixed latency, pending=%d: %s; job service sums=%+v (not production throughput)", pending, time.Since(start), w.DatasetWriteStats())
	}
}
