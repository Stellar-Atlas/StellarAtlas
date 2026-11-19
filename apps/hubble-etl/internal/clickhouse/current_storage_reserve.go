package clickhouse

import (
	"context"
	"errors"
	"fmt"
	"math"
)

const (
	currentSourceOutputBytes   = uint64(8) << 30
	currentWarehouseRunway     = uint64(64) << 30
	CurrentRequestCapacityMode = "request-scoped-v1"
)

var ErrCurrentBulkHeadroom = errors.New("current warehouse bulk headroom")

// CurrentWriteCapacityDeferred identifies a failed pre-write observation for
// which the current worker can take a fresh sample without submitting or
// replaying any insert. Neither error admits writes or lowers the reserve.
func CurrentWriteCapacityDeferred(err error) bool {
	return errors.Is(err, ErrCurrentBulkHeadroom) || errors.Is(err, errPairedBulkCapacityConflict)
}

// ValidateCurrentPublicationPolicy requires the same device binding used by the
// historical writer, plus the explicit source and warehouse workload budgets.
func ValidateCurrentPublicationPolicy(policy HistoricalStoragePolicy) error {
	if err := policy.Validate(); err != nil {
		return err
	}
	if policy.ClickHouseMetadataInode == 0 ||
		policy.SourceCycleOutputBytes != currentSourceOutputBytes ||
		policy.CurrentWarehouseMarginBytes != currentWarehouseRunway {
		return fmt.Errorf("bounded current publication requires the paired disk binding, 8 GiB source cap and 64 GiB warehouse runway")
	}
	return nil
}

func currentPublicationStartBytes(total uint64, minimumBasisPoints uint32) (uint64, error) {
	if total == 0 || minimumBasisPoints > 10_000 {
		return 0, fmt.Errorf("invalid current bulk capacity")
	}
	if minimumBasisPoints != 0 {
		return 0, fmt.Errorf("current bulk capacity requires zero percentage reserve")
	}
	// Unbudgeted startup is a read-only preflight, never HTTP write admission.
	// Already captured source files are reflected in the fresh capacity sample.
	return minimumBulkReserveBytes, nil
}

func currentPublicationRequiredBytes(ctx context.Context, total uint64, minimumBasisPoints uint32) (uint64, error) {
	if ctx == nil {
		return 0, fmt.Errorf("current bulk capacity requires a context")
	}
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	floor, err := currentPublicationStartBytes(total, minimumBasisPoints)
	if err != nil {
		return 0, err
	}
	if ctx.Value(currentWriteBudgetKey{}) == nil {
		if ctx.Value(currentRequestExposureKey{}) != nil {
			return 0, fmt.Errorf("current request exposure requires a write budget")
		}
		return floor, nil
	}
	_, allowance, err := CurrentRequestExposureFromContext(ctx)
	if err != nil {
		return 0, err
	}
	if floor > math.MaxUint64-allowance {
		return 0, fmt.Errorf("current bulk admission budget overflows")
	}
	// This is a request-proportional PLANNING allowance, not a bound on physical
	// output, merge growth or other writers. Existing allocations/reservations
	// remain reflected in fresh paired space; none is credited to this request.
	return floor + allowance, nil
}

// CheckCurrentPublicationBulkReserve reads only disk metadata. It is a fresh
// admission fence, not an atomic reservation against other filesystem writers.
func (c *Client) CheckCurrentPublicationBulkReserve(ctx context.Context, policy HistoricalStoragePolicy) error {
	if c.currentWriteUncertain.Load() {
		return ErrCurrentWriteUncertain
	}
	if err := ValidateCurrentPublicationPolicy(policy); err != nil {
		return err
	}
	total, available, err := c.readPairedBulkCapacity(ctx, policy)
	if err != nil {
		return err
	}
	required, err := currentPublicationRequiredBytes(ctx, total, policy.SourceMinimumFreeBasisPoints)
	if err != nil {
		return err
	}
	if available < required {
		return fmt.Errorf("%w: %d unreserved bytes, require %d", ErrCurrentBulkHeadroom, available, required)
	}
	return ctx.Err()
}
