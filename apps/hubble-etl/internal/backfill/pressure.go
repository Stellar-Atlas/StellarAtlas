package backfill

import (
	"context"
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// PressureGuard admits new batches only; already admitted batches finish normally.
type PressureGuard struct {
	MaximumFullBasisPoints int
	MaximumSomeBasisPoints int
	MaximumInflight        int
	Log                    func(string, string)
	read                   func(string) ([]byte, error)
	wait                   func(context.Context) error
	mu                     sync.Mutex
	blocked                bool
}

// Wait fails closed on unavailable/malformed probes and remains cancellation-aware.
func (g *PressureGuard) Wait(ctx context.Context) error {
	read := g.read
	if read == nil {
		read = os.ReadFile
	}
	wait := g.wait
	if wait == nil {
		wait = func(ctx context.Context) error {
			timer := time.NewTimer(time.Second)
			defer timer.Stop()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-timer.C:
				return nil
			}
		}
	}
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		reason := g.reason(read)
		g.mu.Lock()
		if (reason != "") != g.blocked {
			g.blocked = reason != ""
			if g.Log != nil {
				event := "admission-resumed"
				if g.blocked {
					event = "admission-deferred"
				}
				g.Log(event, reason)
			}
		}
		g.mu.Unlock()
		if reason == "" {
			return nil
		}
		if err := wait(ctx); err != nil {
			return err
		}
	}
}

func (g *PressureGuard) reason(read func(string) ([]byte, error)) string {
	pressure, err := read("/proc/pressure/io")
	if err != nil {
		return fmt.Sprintf("I/O pressure probe unavailable: %v", err)
	}
	some, full, err := parsePressure(pressure)
	if err != nil {
		return err.Error()
	}
	inflight, err := read("/sys/block/md0/inflight")
	if err != nil {
		return fmt.Sprintf("md0 queue probe unavailable: %v", err)
	}
	fields := strings.Fields(string(inflight))
	if len(fields) != 2 {
		return "invalid md0 queue probe"
	}
	count := 0
	for _, field := range fields {
		value, err := strconv.Atoi(field)
		if err != nil || value < 0 || value > 1_000_000 {
			return "invalid md0 queue probe"
		}
		count += value
	}
	if full > float64(g.MaximumFullBasisPoints) || some > float64(g.MaximumSomeBasisPoints) || count > g.MaximumInflight {
		return fmt.Sprintf("I/O full=%.0fbp some=%.0fbp md0-inflight=%d", full, some, count)
	}
	return ""
}

func parsePressure(data []byte) (some, full float64, err error) {
	found := make(map[string]float64, 2)
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 || (fields[0] != "some" && fields[0] != "full") {
			continue
		}
		for _, field := range fields[1:] {
			if !strings.HasPrefix(field, "avg10=") {
				continue
			}
			value, parseErr := strconv.ParseFloat(strings.TrimPrefix(field, "avg10="), 64)
			if parseErr != nil || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > 100 {
				return 0, 0, fmt.Errorf("invalid I/O pressure probe")
			}
			found[fields[0]] = value * 100
		}
	}
	if len(found) != 2 {
		return 0, 0, fmt.Errorf("incomplete I/O pressure probe")
	}
	return found["some"], found["full"], nil
}
