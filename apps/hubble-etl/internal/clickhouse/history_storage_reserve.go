package clickhouse

import (
	"context"
	"fmt"
	"math"
	"net"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// HistoricalStoragePolicy protects the current lane from future history admission.
// The two growth margins are operator-reviewed budgets, not disk quotas or
// guarantees about ClickHouse's output, merges, or concurrent writers.
type HistoricalStoragePolicy struct {
	BulkRoot                            string `json:"bulkRoot"`
	SourceMinimumFreeBytes              uint64 `json:"sourceMinimumFreeBytes"`
	SourceMinimumFreeBasisPoints        uint32 `json:"sourceMinimumFreeBasisPoints"`
	SourceCycleOutputBytes              uint64 `json:"sourceCycleOutputBytes"`
	CurrentWarehouseMarginBytes         uint64 `json:"currentWarehouseMarginBytes"`
	UnreservedGrowthPerHistorySlotBytes uint64 `json:"unreservedGrowthPerHistorySlotBytes"`
}

func (p HistoricalStoragePolicy) Validate() error {
	if !filepath.IsAbs(p.BulkRoot) || p.SourceMinimumFreeBytes == 0 ||
		p.SourceMinimumFreeBasisPoints == 0 || p.SourceMinimumFreeBasisPoints > 10_000 || p.SourceCycleOutputBytes == 0 ||
		p.CurrentWarehouseMarginBytes == 0 || p.UnreservedGrowthPerHistorySlotBytes == 0 {
		return fmt.Errorf("history storage policy requires an absolute bulk root and explicit, valid byte budgets")
	}
	return nil
}

func (p HistoricalStoragePolicy) requiredBytes(total uint64, historySlots int) (uint64, error) {
	if err := p.Validate(); err != nil {
		return 0, err
	}
	if total == 0 || historySlots < 1 || historySlots > 3 {
		return 0, fmt.Errorf("invalid bulk size or historical worker count")
	}
	basisPoints := uint64(p.SourceMinimumFreeBasisPoints)
	proportional := total/10_000*basisPoints + (total%10_000*basisPoints+9_999)/10_000
	required := max(minimumBulkReserveBytes, p.SourceMinimumFreeBytes, proportional)
	// Charge every configured historical slot, including baseline history and
	// concurrently checked admissions. This avoids racing check-and-debits and
	// does not assume another worker (or an ambiguous write) has drained.
	for _, increment := range []uint64{p.SourceCycleOutputBytes, p.CurrentWarehouseMarginBytes} {
		if increment > math.MaxUint64-required {
			return 0, fmt.Errorf("history storage budgets overflow")
		}
		required += increment
	}
	slots := uint64(historySlots)
	if p.UnreservedGrowthPerHistorySlotBytes > (math.MaxUint64-required)/slots {
		return 0, fmt.Errorf("history storage budgets overflow")
	}
	return required + slots*p.UnreservedGrowthPerHistorySlotBytes, nil
}

type bulkFilesystemCapacity struct {
	device    uint64
	total     uint64
	available uint64
}

func historicalUnreservedBytes(before, after, clickhousePath bulkFilesystemCapacity, free, unreserved uint64) (uint64, error) {
	if before.device != after.device || before.device != clickhousePath.device || before.total == 0 ||
		before.total != after.total || before.total != clickhousePath.total || unreserved > free ||
		free > before.total || before.available > before.total || after.available > after.total || clickhousePath.available > clickhousePath.total {
		return 0, fmt.Errorf("historical admission requires consistent capacity on the source bulk device")
	}
	// The ClickHouse reservation is subtracted exactly once. Never credit
	// aggregate reservations against a particular historical slot: they may be
	// for unrelated merges. The per-slot margin is for unattributed growth.
	reservation := free - unreserved
	available := min(before.available, after.available, clickhousePath.available, free)
	return available - min(available, reservation), nil
}

// CheckHistoricalBulkReserve is the opt-in, same-device per-batch history gate.
// The current lane continues to use CheckBulkReserve independently.
func (c *Client) CheckHistoricalBulkReserve(ctx context.Context, policy HistoricalStoragePolicy, historySlots int) error {
	if err := policy.Validate(); err != nil {
		return err
	}
	if host := net.ParseIP(c.endpoint.Hostname()); host == nil || !host.IsLoopback() {
		return fmt.Errorf("historical bulk capacity requires a local ClickHouse endpoint")
	}
	before, err := readBulkFilesystemCapacity(policy.BulkRoot)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	body, err := c.execute(ctx, `SELECT path, free_space, unreserved_space FROM system.disks WHERE name={disk:String} LIMIT 2 FORMAT TabSeparatedRaw`, url.Values{
		"param_disk": {"default"}, "max_execution_time": {"2"},
	}, nil)
	if err != nil {
		return err
	}
	if len(body) > 8192 {
		return fmt.Errorf("historical bulk capacity probe is unavailable or malformed")
	}
	row := strings.TrimSuffix(string(body), "\n")
	fields := strings.Split(row, "\t")
	if strings.ContainsAny(row, "\r\n") || len(fields) != 3 || !filepath.IsAbs(fields[0]) {
		return fmt.Errorf("historical bulk capacity probe is unavailable or malformed")
	}
	free, freeErr := strconv.ParseUint(fields[1], 10, 64)
	unreserved, unreservedErr := strconv.ParseUint(fields[2], 10, 64)
	if freeErr != nil || unreservedErr != nil {
		return fmt.Errorf("historical bulk capacity probe is unavailable or malformed")
	}
	clickhousePath, err := readBulkFilesystemCapacity(fields[0])
	if err != nil {
		return err
	}
	after, err := readBulkFilesystemCapacity(policy.BulkRoot)
	if err != nil {
		return err
	}
	available, err := historicalUnreservedBytes(before, after, clickhousePath, free, unreserved)
	if err != nil {
		return err
	}
	required, err := policy.requiredBytes(after.total, historySlots)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if available < required {
		return fmt.Errorf("historical bulk headroom: %d unreserved bytes, require %d for current work and %d history slots", available, required, historySlots)
	}
	return nil
}
