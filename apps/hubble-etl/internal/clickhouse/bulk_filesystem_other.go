//go:build !linux

package clickhouse

import "fmt"

func readBulkFilesystemCapacity(path string) (bulkFilesystemCapacity, error) {
	return readBulkCapacityDirectory(path, 0)
}

func readBulkCapacityDirectory(string, uint64) (bulkFilesystemCapacity, error) {
	return bulkFilesystemCapacity{}, fmt.Errorf("historical bulk filesystem capacity requires Linux")
}
