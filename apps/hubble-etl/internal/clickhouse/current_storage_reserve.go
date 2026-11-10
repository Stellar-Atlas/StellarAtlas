package clickhouse

import (
	"context"
	"errors"
	"fmt"
	"math"
)

const (
	currentSourceOutputBytes = uint64(8) << 30
	currentWarehouseRunway   = uint64(64) << 30
	currentStartupCushion    = uint64(32) << 30
)

var ErrCurrentBulkHeadroom = errors.New("current warehouse bulk headroom")

// CurrentWriteCapacityDeferred identifies a failed pre-write observation for
// which the current worker can take a fresh sample without submitting or
// replaying any insert. Neither error admits writes or lowers the reserve.
func CurrentWriteCapacityDeferred(err error) bool {
	return errors.Is(err, ErrCurrentBulkHeadroom) || errors.Is(err, errPairedBulkCapacityConflict)
}

// ValidateCurrentPublicationPolicy requires the same device binding used by the
// historical writer. Its higher historical threshold remains unchanged.
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
	basisPoints := uint64(max(minimumBasisPoints, 500))
	floor := total/10_000*basisPoints + (total%10_000*basisPoints+9_999)/10_000
	allowance := currentSourceOutputBytes + currentWarehouseRunway + currentStartupCushion
	if floor > math.MaxUint64-allowance {
		return 0, fmt.Errorf("current bulk admission budget overflows")
	}
	return floor + allowance, nil
}

// CheckCurrentPublicationBulkReserve reads only disk metadata. It is a fresh
// admission fence, not an atomic reservation against other filesystem writers.
func (c *Client) CheckCurrentPublicationBulkReserve(ctx context.Context, policy HistoricalStoragePolicy) error {
	if err := ValidateCurrentPublicationPolicy(policy); err != nil {
		return err
	}
	total, available, err := c.readPairedBulkCapacity(ctx, policy)
	if err != nil {
		return err
	}
	required, err := currentPublicationStartBytes(total, policy.SourceMinimumFreeBasisPoints)
	if err != nil {
		return err
	}
	if available < required {
		return fmt.Errorf("%w: %d unreserved bytes, require %d", ErrCurrentBulkHeadroom, available, required)
	}
	return ctx.Err()
}
