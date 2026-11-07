package backfill

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/catalog"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/clickhouse"
)

func TestAgedOutCatchupBandPreservesFairnessAndRestartAdmission(t *testing.T) {
	const tip uint32 = 80_000
	const oldest = tip - agedOutMaximumLedgerLag
	const floor = tip - currentWindowLedgers
	ctx := context.Background()
	batchAt := func(end uint32) catalog.Batch {
		id := fmt.Sprint(end)
		return catalog.Batch{ID: id, StartLedger: end - 63, EndLedger: end, LedgerCount: 64, SourceSHA256: id}
	}
	var dense []catalog.Batch
	for end := oldest + 64; end <= floor; end += 64 {
		dense = append(dense, batchAt(end))
	}
	if len(dense) != 206 {
		t.Fatal(len(dense))
	}
	target := dense[134]   // The first admission page is entirely complete.
	olderGap := dense[100] // Older than 8,192 ledgers from tip.
	live := batchAt(tip)
	completed := make(map[string]string)
	incomplete := make(map[string]string)
	for _, batch := range dense[:134] {
		completed[batch.ID] = batch.SourceSHA256
	}
	var pages []int
	var probes int
	ordinary := batchAt(oldest - 1024)
	io := currentWorkerIO{
		recent: func(context.Context) ([]catalog.Batch, error) { return []catalog.Batch{live}, nil },
		agedOut: func(context.Context) (uint32, []catalog.Batch, error) {
			probes++
			return tip, dense, nil
		},
		states: func(_ context.Context, ids []string) (clickhouse.BatchAdmissionSnapshot, error) {
			if len(ids) > agedOutAdmissionPageSize {
				t.Fatal("exceeded existing ClickHouse admission cap")
			}
			pages = append(pages, len(ids))
			return clickhouse.BatchAdmissionSnapshot{Completed: completed, Incomplete: incomplete}, nil
		},
		history: func(context.Context) ([]catalog.Batch, error) { return []catalog.Batch{ordinary}, nil },
		allStates: func(context.Context) (clickhouse.BatchAdmissionSnapshot, error) {
			return clickhouse.BatchAdmissionSnapshot{}, nil
		},
	}
	claims := newCurrentClaims()
	history := laneSelection{claims: claims}
	current := laneSelection{claims: claims, current: true}
	requireNext := func(selector *laneSelection, want catalog.Batch) {
		t.Helper()
		got, found, err := selector.next(ctx, io)
		if err != nil || !found || got.ID != want.ID {
			t.Fatalf("next=%+v, %v, %v; want %s", got, found, err, want.ID)
		}
	}
	requireNext(&current, live)
	pages = nil
	requireNext(&history, target)
	if len(pages) != 2 || pages[0] != 128 || pages[1] != 78 {
		t.Fatalf("wrong admission pages: %v", pages)
	}
	if ok, err := claims.reserve(target, false); ok || err != nil {
		t.Fatalf("duplicate claim: %v, %v", ok, err)
	}
	requireNext(&history, ordinary)
	if probes != 1 {
		t.Fatal("ordinary history lost its turn during catch-up cadence")
	}
	history.release(target) // Interrupted before a durable write.
	if got, ok, err := history.nextAgedOut(ctx, io, history.lastAgedOutProbe.Add(time.Minute)); err != nil || !ok || got.ID != target.ID {
		t.Fatalf("released unstarted batch not eligible again: %+v %v %v", got, ok, err)
	}
	// Restart loses local claims only. Persistent ambiguity and completion
	// remain authoritative; a different no-receipt gap is automatically picked.
	incomplete[target.ID] = target.SourceSHA256
	delete(completed, olderGap.ID)
	restarted := laneSelection{claims: newCurrentClaims()}
	requireNext(&restarted, olderGap)
	completed[olderGap.ID] = olderGap.SourceSHA256
	restarted = laneSelection{claims: newCurrentClaims()}
	requireNext(&restarted, dense[135])
}

func TestAgedOutCatchupMetadataTimeoutFallsThrough(t *testing.T) {
	ctx := context.Background()
	older := catalog.Batch{ID: "old", StartLedger: 1000, EndLedger: 1063, LedgerCount: 64, SourceSHA256: "old"}
	completedTip := catalog.Batch{ID: "tip", StartLedger: 10_000, EndLedger: 10_063, LedgerCount: 64, SourceSHA256: "tip"}
	for _, atAdmission := range []bool{false, true} {
		history := laneSelection{claims: newCurrentClaims()}
		notices := 0
		io := currentWorkerIO{
			agedOut: func(context.Context) (uint32, []catalog.Batch, error) {
				if !atAdmission {
					return 0, nil, context.DeadlineExceeded
				}
				return 80_000, []catalog.Batch{{ID: "aged", EndLedger: 70_000}}, nil
			},
			states: func(_ context.Context, ids []string) (clickhouse.BatchAdmissionSnapshot, error) {
				if ids[0] == "aged" {
					return clickhouse.BatchAdmissionSnapshot{}, context.DeadlineExceeded
				}
				return clickhouse.BatchAdmissionSnapshot{}, nil
			},
			history: func(context.Context) ([]catalog.Batch, error) {
				return []catalog.Batch{older, completedTip}, nil
			},
			allStates: func(context.Context) (clickhouse.BatchAdmissionSnapshot, error) {
				return clickhouse.BatchAdmissionSnapshot{Completed: map[string]string{"tip": "tip"}}, nil
			},
			notice: func(current bool, operation string, err error) {
				if current || operation != "aged-out-catchup-deferred" || err != context.DeadlineExceeded {
					t.Fatalf("wrong notice: %t %q %v", current, operation, err)
				}
				notices++
			},
		}
		got, found, err := history.next(ctx, io)
		if err != nil || !found || got.ID != older.ID || notices != 1 {
			t.Fatalf("timeout blocked ordinary history: %+v %v %v notices=%d", got, found, err, notices)
		}
	}
}

func TestAgedOutProbeDoesNotBlockHistoryCompletionOrSelection(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	batchAt := func(id string, end uint32) catalog.Batch {
		return catalog.Batch{ID: id, StartLedger: end - 63, EndLedger: end, LedgerCount: 64, SourceSHA256: id}
	}
	prior, ordinary := batchAt("prior", 68_000), batchAt("ordinary", 69_000)
	ambiguous, priority, live := batchAt("ambiguous", 69_500), batchAt("priority", 70_000), batchAt("live", 80_000)
	claims := newCurrentClaims()
	claims.observeTip(80_000)
	if ok, err := claims.reserve(prior, false); !ok || err != nil {
		t.Fatalf("prepare admitted completion: %t %v", ok, err)
	}
	selector := &laneSelection{claims: claims, history: []catalog.Batch{ordinary}, loadedAt: time.Now()}
	started, releaseProbe, exited := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var probes atomic.Int32
	io := currentWorkerIO{
		recent: func(context.Context) ([]catalog.Batch, error) { return []catalog.Batch{live}, nil },
		agedOut: func(ctx context.Context) (uint32, []catalog.Batch, error) {
			if probes.Add(1) != 1 {
				return 0, nil, fmt.Errorf("overlapping priority probe")
			}
			close(started)
			select {
			case <-releaseProbe:
				return 80_000, []catalog.Batch{prior, ordinary, ambiguous, priority}, nil
			case <-ctx.Done():
				return 0, nil, ctx.Err()
			}
		},
		states: func(context.Context, []string) (clickhouse.BatchAdmissionSnapshot, error) {
			return clickhouse.BatchAdmissionSnapshot{Incomplete: map[string]string{ambiguous.ID: ambiguous.SourceSHA256}}, nil
		},
	}
	type selectionResult struct {
		batch catalog.Batch
		found bool
		err   error
	}
	result := make(chan selectionResult, 1)
	go func() {
		defer close(exited)
		batch, found, err := selector.next(ctx, io)
		result <- selectionResult{batch, found, err}
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case <-releaseProbe:
		default:
			close(releaseProbe)
		}
		select {
		case <-exited:
		case <-time.After(time.Second):
			t.Error("priority probe did not join cancellation")
		}
	})
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("priority probe did not enter")
	}
	finished := make(chan struct{})
	go func() { selector.finish(prior); close(finished) }()
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("priority metadata I/O blocked admitted completion bookkeeping")
	}
	ordinaryResult := make(chan selectionResult, 1)
	go func() {
		batch, found, err := selector.next(ctx, io)
		ordinaryResult <- selectionResult{batch, found, err}
	}()
	select {
	case got := <-ordinaryResult:
		if got.err != nil || !got.found || got.batch.ID != ordinary.ID {
			t.Fatalf("ordinary history did not advance: %+v", got)
		}
	case <-time.After(time.Second):
		t.Fatal("priority metadata I/O blocked ordinary history selection")
	}
	// Advancing the cadence cannot start a second probe while the first is owned.
	if _, found, err := selector.nextAgedOut(ctx, io, time.Now().Add(2*time.Minute)); found || err != nil || probes.Load() != 1 {
		t.Fatalf("priority ownership lost: found=%t err=%v probes=%d", found, err, probes.Load())
	}
	current := &laneSelection{current: true, claims: claims}
	if got, found, err := current.next(ctx, io); err != nil || !found || got.ID != live.ID {
		t.Fatalf("current lane did not advance independently: %+v %t %v", got, found, err)
	}
	close(releaseProbe)
	got := <-result
	if got.err != nil || !got.found || got.batch.ID != priority.ID {
		t.Fatalf("priority probe ignored concurrent claims/completion or ambiguity: %+v", got)
	}
}

func TestAgedOutProbeCancellationJoinsAndReleasesOwnership(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	entered := make(chan struct{})
	var probes atomic.Int32
	target := catalog.Batch{ID: "priority", StartLedger: 69_937, EndLedger: 70_000, LedgerCount: 64, SourceSHA256: "priority"}
	io := currentWorkerIO{
		agedOut: func(ctx context.Context) (uint32, []catalog.Batch, error) {
			if probes.Add(1) == 1 {
				close(entered)
				<-ctx.Done()
				return 0, nil, ctx.Err()
			}
			return 80_000, []catalog.Batch{target}, nil
		},
		states: func(context.Context, []string) (clickhouse.BatchAdmissionSnapshot, error) {
			return clickhouse.BatchAdmissionSnapshot{}, nil
		},
	}
	selector := &laneSelection{claims: newCurrentClaims()}
	joined := make(chan error, 1)
	go func() {
		_, found, err := selector.nextAgedOut(ctx, io, time.Now())
		if found {
			joined <- fmt.Errorf("cancelled probe reserved work")
			return
		}
		joined <- err
	}()
	<-entered
	cancel()
	select {
	case err := <-joined:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("probe did not retain parent cancellation: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("cancelled probe did not join")
	}
	if batch, found, err := selector.nextAgedOut(context.Background(), io, time.Now().Add(2*time.Minute)); err != nil || !found || batch.ID != target.ID || probes.Load() != 2 {
		t.Fatalf("settled probe retained ownership: %+v %t %v probes=%d", batch, found, err, probes.Load())
	}
}
