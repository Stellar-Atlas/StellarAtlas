package backfill

import (
	"fmt"
	"strings"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/catalog"
)

// selectPendingBatches preserves catalog order and immutable digest checks.
// Priority changes admission order only; it never bypasses normal ingestion.
func selectPendingBatches(batches []catalog.Batch, completed map[string]string, priorityID string, maximum int, minimumStart uint32, recent int, incomplete map[string]string) ([]catalog.Batch, int, error) {
	if err := ValidateBatchScheduling(maximum, recent); err != nil {
		return nil, 0, err
	}
	pending := make([]catalog.Batch, 0, len(batches))
	completedCount := 0
	priorityFound := priorityID == ""
	for _, batch := range batches {
		priority := priorityID != "" && strings.EqualFold(batch.ID, priorityID)
		priorityFound = priorityFound || priority
		if digest, ok := completed[batch.ID]; ok {
			if digest != batch.SourceSHA256 {
				return nil, 0, fmt.Errorf("batch %s changed immutable digest from %s to %s", batch.ID, digest, batch.SourceSHA256)
			}
			completedCount++
			continue
		}
		if digest, attempted := incomplete[batch.ID]; attempted {
			if digest != batch.SourceSHA256 {
				return nil, 0, fmt.Errorf("incomplete batch %s changed immutable digest", batch.ID)
			}
			if priority {
				return nil, 0, fmt.Errorf("priority batch %s requires separately verified recovery", batch.ID)
			}
			continue
		}
		if batch.StartLedger < minimumStart {
			if batch.EndLedger >= minimumStart || priority {
				return nil, 0, fmt.Errorf("batch %s crosses or conflicts with the minimum start ledger %d", batch.ID, minimumStart)
			}
			// Admission only: do not count deferred failures as completed or
			// alter their existing publication/failure manifest.
			continue
		}
		pending = append(pending, batch)
	}
	if !priorityFound {
		return nil, 0, fmt.Errorf("priority batch %s is absent from this network's immutable catalog", priorityID)
	}
	if recent > 0 {
		// Select from the catalog tail, not the pending tail. A completed head
		// must not turn this lane into an unbounded reverse-history backfill.
		head := make(map[string]bool, recent)
		for i := max(0, len(batches)-recent); i < len(batches); i++ {
			head[batches[i].ID] = true
		}
		ordered := make([]catalog.Batch, 0, len(pending))
		for _, batch := range pending {
			if head[batch.ID] {
				ordered = append(ordered, batch)
			}
		}
		for _, batch := range pending {
			if !head[batch.ID] {
				ordered = append(ordered, batch)
			}
		}
		pending = ordered
	}
	for index, batch := range pending {
		if priorityID != "" && strings.EqualFold(batch.ID, priorityID) {
			copy(pending[1:index+1], pending[:index])
			pending[0] = batch
			break
		}
	}
	if maximum > 0 && len(pending) > maximum {
		pending = pending[:maximum]
	}
	return pending, completedCount, nil
}

// A finite cycle reloads the source catalog; spare capacity protects backfill.
func ValidateBatchScheduling(maximum, recent int) error {
	if maximum < 0 || recent < 0 || recent > 64 {
		return fmt.Errorf("maximum batches must be nonnegative and recent batches between 0 and 64")
	}
	if recent > 0 && maximum <= recent {
		return fmt.Errorf("recent batch priority requires a finite maximum batches greater than recent batches")
	}
	return nil
}
