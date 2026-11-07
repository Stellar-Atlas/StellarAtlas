package backfill

import (
	"context"
	"errors"
	"time"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/catalog"
)

const agedOutProbeInterval = time.Minute
const agedOutProbeBudget = 2500 * time.Millisecond
const agedOutMaximumLedgerLag uint32 = 17_280
const agedOutAdmissionPageSize = 128 // Existing ClickHouse BatchAdmissionFor bound.

func (s *laneSelection) nextAgedOut(ctx context.Context, io currentWorkerIO, now time.Time) (catalog.Batch, bool, error) {
	s.mu.Lock()
	if io.agedOut == nil || io.states == nil || s.agedOutProbeInFlight || (!s.lastAgedOutProbe.IsZero() && now.Sub(s.lastAgedOutProbe) < agedOutProbeInterval) {
		s.mu.Unlock()
		return catalog.Batch{}, false, nil
	}
	s.lastAgedOutProbe = now
	s.agedOutProbeInFlight = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.agedOutProbeInFlight = false
		s.mu.Unlock()
	}()
	probe, cancel := context.WithTimeout(ctx, agedOutProbeBudget)
	defer cancel()
	latest, rows, err := io.agedOut(probe)
	if err != nil {
		return catalog.Batch{}, false, agedOutProbeError(ctx, io, err)
	}
	s.claims.observeTip(latest)
	// The catalog returns at most 206 eligible batches, oldest first. Check at
	// most two admission pages without letting a completed first page hide gaps.
	for start := 0; start < len(rows); start += agedOutAdmissionPageSize {
		if err := probe.Err(); err != nil {
			return catalog.Batch{}, false, agedOutProbeError(ctx, io, err)
		}
		window := rows[start:min(start+agedOutAdmissionPageSize, len(rows))]
		ids := make([]string, 0, len(window))
		for _, row := range window {
			ids = append(ids, row.ID)
		}
		state, err := io.states(probe, ids)
		if err != nil {
			return catalog.Batch{}, false, agedOutProbeError(ctx, io, err)
		}
		pending, _, err := selectPendingBatches(window, state.Completed, "", 0, s.minimum, 0, state.Incomplete)
		if err != nil {
			return catalog.Batch{}, false, err
		}
		for _, batch := range pending {
			if err := probe.Err(); err != nil {
				return catalog.Batch{}, false, agedOutProbeError(ctx, io, err)
			}
			ok, err := s.claims.reserve(batch, false)
			if ok || err != nil {
				return batch, ok, err
			}
		}
	}
	return catalog.Batch{}, false, nil
}

func agedOutProbeError(ctx context.Context, io currentWorkerIO, err error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if !errors.Is(err, context.DeadlineExceeded) && !retryWorkerMetadata(err) {
		return err
	}
	if io.notice != nil {
		io.notice(false, "aged-out-catchup-deferred", err)
	}
	return nil
}
