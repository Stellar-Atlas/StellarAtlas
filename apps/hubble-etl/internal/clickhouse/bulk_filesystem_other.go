//go:build !linux

package clickhouse

import "fmt"

func readBulkFilesystemCapacity(string) (bulkFilesystemCapacity, error) {
	return bulkFilesystemCapacity{}, fmt.Errorf("historical bulk filesystem capacity requires Linux")
}
