package backfill

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/catalog"
)

type currentClaims struct {
	mu       sync.Mutex
	active   map[string]string
	resolved map[string]string
	order    []string
	latest   uint32
}

func newCurrentClaims() *currentClaims {
	return &currentClaims{active: make(map[string]string), resolved: make(map[string]string)}
}

func (c *currentClaims) observe(batches []catalog.Batch) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, batch := range batches {
		c.latest = max(c.latest, batch.EndLedger)
	}
}

func (c *currentClaims) reserve(batch catalog.Batch, current bool) (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, registry := range []map[string]string{c.active, c.resolved} {
		if digest, ok := registry[batch.ID]; ok {
			if digest != batch.SourceSHA256 {
				return false, fmt.Errorf("batch %s changed immutable digest", batch.ID)
			}
			return false, nil
		}
	}
	floor := uint32(0)
	if c.latest > currentWindowLedgers {
		floor = c.latest - currentWindowLedgers
	}
	if (batch.EndLedger > floor) != current {
		return false, nil
	}
	if current && (batch.LedgerCount < 64 || batch.LedgerCount > 1024) {
		return false, fmt.Errorf("current batch %s is outside the 64..1024 ledger bound", batch.ID)
	}
	c.active[batch.ID] = batch.SourceSHA256
	return true, nil
}

func (c *currentClaims) finish(batch catalog.Batch) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.active, batch.ID)
	// Remember recent resolutions across stale snapshots. Persistent complete
	// and ambiguous attempts remain excluded by the immutable manifest.
	c.resolved[batch.ID] = batch.SourceSHA256
	c.order = append(c.order, batch.ID)
	if len(c.order) > 1024 {
		delete(c.resolved, c.order[0])
		c.order = c.order[1:]
	}
}

func (c *currentClaims) release(batch catalog.Batch) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.active[batch.ID] == batch.SourceSHA256 {
		delete(c.active, batch.ID)
	}
}

func (c *currentClaims) resolvedBatch(batch catalog.Batch) (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	digest, found := c.resolved[batch.ID]
	if found && digest != batch.SourceSHA256 {
		return false, fmt.Errorf("batch %s changed immutable digest", batch.ID)
	}
	return found, nil
}

type laneSelection struct {
	mu       sync.Mutex // Protect selection/release only; never held during ingest.
	current  bool
	claims   *currentClaims
	minimum  uint32
	history  []catalog.Batch
	position int
	loadedAt time.Time
	reserved map[string]int
}

func (s *laneSelection) release(batch catalog.Batch) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.claims.release(batch)
	if index, ok := s.reserved[batch.ID]; ok {
		s.position = min(s.position, index)
		delete(s.reserved, batch.ID)
	}
}

func (s *laneSelection) finish(batch catalog.Batch) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.claims.finish(batch)
	delete(s.reserved, batch.ID)
}

func (s *laneSelection) next(ctx context.Context, io currentWorkerIO) (catalog.Batch, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current {
		batches, err := io.recent(ctx)
		if err != nil {
			return catalog.Batch{}, false, err
		}
		s.claims.observe(batches)
		ids := make([]string, 0, len(batches))
		for _, batch := range batches {
			ids = append(ids, batch.ID)
		}
		state, err := io.states(ctx, ids)
		if err != nil {
			return catalog.Batch{}, false, err
		}
		pending, _, err := selectPendingBatches(batches, state.Completed, "", 0, s.minimum, 0, state.Incomplete)
		if err != nil {
			return catalog.Batch{}, false, err
		}
		for _, batch := range pending {
			ok, err := s.claims.reserve(batch, true)
			if ok || err != nil {
				return batch, ok, err
			}
		}
		return catalog.Batch{}, false, nil
	}
	// Reservation indices remain tied to this snapshot until every claim leaves it.
	if s.loadedAt.IsZero() || (s.position == len(s.history) && len(s.reserved) == 0 && time.Since(s.loadedAt) >= 5*time.Minute) {
		batches, err := io.history(ctx)
		if err != nil {
			return catalog.Batch{}, false, err
		}
		s.claims.observe(batches)
		state, err := io.allStates(ctx)
		if err != nil {
			return catalog.Batch{}, false, err
		}
		pending, _, err := selectPendingBatches(batches, state.Completed, "", 0, s.minimum, 0, state.Incomplete)
		if err != nil {
			return catalog.Batch{}, false, err
		}
		s.history, s.position, s.loadedAt = pending, 0, time.Now()
	}
	for s.position < len(s.history) {
		batch := s.history[s.position]
		resolved, err := s.claims.resolvedBatch(batch)
		if err != nil {
			return catalog.Batch{}, false, err
		}
		if resolved {
			s.position++
			continue
		}
		state, err := io.states(ctx, []string{batch.ID})
		if err != nil {
			return catalog.Batch{}, false, err
		}
		pending, _, err := selectPendingBatches([]catalog.Batch{batch}, state.Completed, "", 0, s.minimum, 0, state.Incomplete)
		if err != nil {
			return catalog.Batch{}, false, err
		}
		if len(pending) == 0 {
			s.position++
			continue
		}
		ok, err := s.claims.reserve(batch, false)
		if ok {
			if s.reserved == nil {
				s.reserved = make(map[string]int)
			}
			s.reserved[batch.ID] = s.position
			s.position++
			return batch, true, nil
		}
		if err != nil {
			return catalog.Batch{}, false, err
		}
		// Keep this boundary candidate for later: as the current window moves
		// forward, the historical lane can recover any remaining older gaps.
		return catalog.Batch{}, false, nil
	}
	return catalog.Batch{}, false, nil
}
