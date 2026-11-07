package backfill

import (
	"context"
	"sync"
	"time"
)

// HistoryAdmissionHold defers only new historical work. It never cancels an
// admitted import. An unset marker path disables both polling and marker access.
type HistoryAdmissionHold struct {
	MarkerPath string
	Log        func(event, reason string)
	probe      func(string) string
	wait       func(context.Context) error
	mu         sync.Mutex
	held       bool
}

func (h *HistoryAdmissionHold) Wait(ctx context.Context) error {
	if h == nil || h.MarkerPath == "" {
		return nil
	}
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		if !h.blocked() {
			return nil
		}
		wait := h.wait
		if wait == nil {
			wait = func(ctx context.Context) error { return waitReadiness(ctx, time.Second) }
		}
		if err := wait(ctx); err != nil {
			return err
		}
	}
}

// blocked is a fresh check at admission boundaries, not a cached permit. Unsafe
// or unreadable control state is a hold, never a shared worker-group failure.
func (h *HistoryAdmissionHold) blocked() bool {
	if h == nil || h.MarkerPath == "" {
		return false
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	probe := h.probe
	if probe == nil {
		probe = historyHoldMarkerReason
	}
	reason := probe(h.MarkerPath)
	held := reason != ""
	if held != h.held {
		h.held = held
		if h.Log != nil {
			event := "history-admission-resumed"
			if held {
				event = "history-admission-held"
			}
			h.Log(event, reason)
		}
	}
	return held
}
