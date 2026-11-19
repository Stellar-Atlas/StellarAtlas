package clickhouse

import (
	"context"
	"fmt"
	"math"
)

// This draft uses the existing configured current maximum, not the generic
// writer's larger ceiling. It makes no claim about physical ClickHouse growth.
const currentRequestMaximumLogicalBytes = uint64(32) << 30

type currentRequestExposureKey struct{}

// A value, not a mutable budget or reservation. Its scope must be exactly one
// prospective synchronous request's fresh capacity check.
type currentRequestExposure struct{ logicalBytes uint64 }

// withCurrentRequestExposure does not debit, refund or replace the total write
// quota. In particular, the grouped promotion copy was prepaid by staging;
// stagedBytes here describes its prospective exposure, not another quota debit.
func withCurrentRequestExposure(ctx context.Context, bodyBytes, stagedBytes uint64, promotion bool) (context.Context, error) {
	if ctx == nil {
		return nil, fmt.Errorf("current request exposure requires a context")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	payloadBytes := bodyBytes
	if promotion {
		if bodyBytes != 0 || stagedBytes == 0 {
			return nil, fmt.Errorf("current promotion exposure requires only known staged bytes")
		}
		payloadBytes = stagedBytes
	} else if bodyBytes == 0 || stagedBytes != 0 {
		return nil, fmt.Errorf("current row exposure requires only a nonempty body")
	}
	if payloadBytes > math.MaxUint64-uint64(currentWriteOverhead) {
		return nil, fmt.Errorf("current request exposure overflows")
	}
	logicalBytes := payloadBytes + uint64(currentWriteOverhead)
	if _, err := currentRequestPlanningAllowance(logicalBytes); err != nil {
		return nil, err
	}
	return context.WithValue(ctx, currentRequestExposureKey{}, currentRequestExposure{logicalBytes: logicalBytes}), nil
}

// CurrentRequestExposureFromContext returns immutable scalar copies of the
// prospective logical exposure and its PLANNING allowance. The latter scales
// the existing 64 GiB runway against the existing 32 GiB configured maximum
// (2x); it is explicitly NOT an upper bound on physical storage, merges or
// other writers. Missing, zero or oversized exposure must refuse this guard.
func CurrentRequestExposureFromContext(ctx context.Context) (logicalBytes, planningAllowanceBytes uint64, err error) {
	if ctx == nil {
		return 0, 0, fmt.Errorf("current request exposure requires a context")
	}
	if err := ctx.Err(); err != nil {
		return 0, 0, err
	}
	exposure, ok := ctx.Value(currentRequestExposureKey{}).(currentRequestExposure)
	if !ok {
		return 0, 0, fmt.Errorf("current request exposure is missing")
	}
	allowance, err := currentRequestPlanningAllowance(exposure.logicalBytes)
	if err != nil {
		return 0, 0, err
	}
	return exposure.logicalBytes, allowance, nil
}

func currentRequestPlanningAllowance(logicalBytes uint64) (uint64, error) {
	if logicalBytes == 0 || logicalBytes > currentRequestMaximumLogicalBytes {
		return 0, fmt.Errorf("current request exposure must be positive and at most 32 GiB")
	}
	if currentWarehouseRunway%currentRequestMaximumLogicalBytes != 0 {
		return 0, fmt.Errorf("current request planning ratio is not integral")
	}
	multiplier := currentWarehouseRunway / currentRequestMaximumLogicalBytes
	if multiplier == 0 || logicalBytes > math.MaxUint64/multiplier {
		return 0, fmt.Errorf("current request planning allowance overflows")
	}
	allowance := logicalBytes * multiplier
	if allowance > currentWarehouseRunway {
		return 0, fmt.Errorf("current request planning allowance exceeds the existing runway")
	}
	return allowance, nil
}
