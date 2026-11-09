package clickhouse

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

const minimumBulkReserveBytes = uint64(500) << 30

// CheckBulkReserve includes ClickHouse's active merge reservations. The NVMe
// read-model disks retain their configured ClickHouse free-space reservations.
func (c *Client) CheckBulkReserve(ctx context.Context) error {
	body, err := c.execute(ctx, "SELECT unreserved_space FROM system.disks WHERE name={disk:String} FORMAT TabSeparated", url.Values{"param_disk": {"default"}}, nil)
	if err != nil {
		return err
	}
	available, err := strconv.ParseUint(strings.TrimSpace(string(body)), 10, 64)
	if err != nil {
		return fmt.Errorf("bulk free-space probe is unavailable or malformed")
	}
	if available < minimumBulkReserveBytes {
		return fmt.Errorf("bulk free-space reserve: %d unreserved bytes, require %d", available, minimumBulkReserveBytes)
	}
	return nil
}
