package backfill

import (
	"fmt"
	"strings"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/catalog"
)

// selectPendingBatches preserves catalog order and immutable digest checks.
// Priority changes admission order only; it never bypasses normal ingestion.
func selectPendingBatches(batches []catalog.Batch, completed map[string]string, priorityID string, maximum int) ([]catalog.Batch, int, error) {
	pending := make([]catalog.Batch, 0, len(batches))
	completedCount, priorityIndex := 0, -1
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
		if priority {
			priorityIndex = len(pending)
		}
		pending = append(pending, batch)
	}
	if !priorityFound {
		return nil, 0, fmt.Errorf("priority batch %s is absent from this network's immutable catalog", priorityID)
	}
	if priorityIndex > 0 {
		priority := pending[priorityIndex]
		copy(pending[1:priorityIndex+1], pending[:priorityIndex])
		pending[0] = priority
	}
	if maximum > 0 && len(pending) > maximum {
		pending = pending[:maximum]
	}
	return pending, completedCount, nil
}
