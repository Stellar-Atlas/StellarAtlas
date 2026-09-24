package backfill

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/clickhouse"
)

// WarehouseReadinessGuard is shared by every worker and cycle. Healthy admission
// is cached; one worker probes while others wait without opening connections.
// Only unhealthy work is delayed. Already admitted batches are never cancelled.
type WarehouseReadinessGuard struct {
	Probe        func(context.Context) error
	Log          func(string, string)
	HealthyFor   time.Duration
	RetryAfter   time.Duration
	ProbeTimeout time.Duration

	mu         sync.Mutex
	running    chan struct{}
	freshUntil time.Time
	retryAt    time.Time
	failure    error
	revision   uint64
	reported   bool
}

func (g *WarehouseReadinessGuard) Wait(ctx context.Context) error {
	if g.Probe == nil {
		return fmt.Errorf("warehouse readiness probe is required")
	}
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		g.mu.Lock()
		if running := g.running; running != nil {
			g.mu.Unlock()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-running:
				continue
			}
		}
		if g.failure == nil && time.Now().Before(g.freshUntil) {
			g.mu.Unlock()
			return nil
		}
		if delay := time.Until(g.retryAt); delay > 0 {
			g.mu.Unlock()
			if err := waitReadiness(ctx, delay); err != nil {
				return err
			}
			continue
		}
		g.running = make(chan struct{})
		revision := g.revision
		g.mu.Unlock()

		probeCtx, cancel := context.WithTimeout(ctx, durationOr(g.ProbeTimeout, 10*time.Second))
		err := g.Probe(probeCtx)
		if err == nil {
			err = probeCtx.Err()
		}
		cancel()
		g.mu.Lock()
		// A concurrent failed INSERT invalidates even an in-flight successful
		// probe. A caller's cancellation must not poison other workers' cache.
		if revision == g.revision && ctx.Err() == nil {
			if err != nil {
				g.reportFailure(err)
				g.retryAt = time.Now().Add(durationOr(g.RetryAfter, 15*time.Second))
			} else {
				if g.failure != nil || !g.reported {
					g.log("warehouse-ready", "all required tables loaded; immutable batch admission enabled")
				}
				g.reported = true
				g.failure = nil
				g.retryAt = time.Time{}
				g.freshUntil = time.Now().Add(durationOr(g.HealthyFor, time.Minute))
			}
		}
		close(g.running)
		g.running = nil
		g.mu.Unlock()
	}
}

// Invalidate ignores local input/decoder failures and normal shutdown. Request
// errors trigger a fresh table probe, not an assumption that source data is bad.
func (g *WarehouseReadinessGuard) Invalidate(err error) bool {
	if !clickhouse.IsWarehouseFailure(err) {
		return false
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	g.revision++
	g.freshUntil = time.Time{}
	g.reportFailure(err)
	// Do not erase an existing retry deadline when another in-flight batch
	// fails; repeated failures must not bypass the shared unhealthy backoff.
	return true
}

func (g *WarehouseReadinessGuard) reportFailure(err error) {
	if g.failure == nil || g.failure.Error() != err.Error() {
		g.log("warehouse-unavailable", err.Error()+"; new batch admission paused; repair warehouse availability, not source batches")
	}
	g.failure = err
	g.reported = true
	g.freshUntil = time.Time{}
}

func (g *WarehouseReadinessGuard) log(event, reason string) {
	if g.Log != nil {
		reason = strings.ToValidUTF8(reason, "?")
		if len(reason) > 4096 {
			reason = reason[:4096]
		}
		g.Log(event, reason)
	}
}

func durationOr(value, fallback time.Duration) time.Duration {
	if value > 0 {
		return value
	}
	return fallback
}

func waitReadiness(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func waitBatchAdmission(ctx context.Context, config Config) error {
	if config.ReadinessGuard != nil {
		if err := config.ReadinessGuard.Wait(ctx); err != nil {
			return err
		}
	}
	if config.PressureGuard != nil {
		if err := config.PressureGuard.Wait(ctx); err != nil {
			return err
		}
	}
	// A pressure wait may outlast the healthy cache or another worker may
	// invalidate it. Recheck immediately before opening/decoding a source.
	if config.ReadinessGuard != nil {
		return config.ReadinessGuard.Wait(ctx)
	}
	return nil
}
