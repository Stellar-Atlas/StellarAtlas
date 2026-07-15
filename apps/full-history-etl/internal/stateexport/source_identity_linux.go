//go:build linux

package stateexport

import (
	"os"
	"syscall"
)

func sameSourceChangeTime(expected, actual os.FileInfo) bool {
	expectedStat, expectedOK := expected.Sys().(*syscall.Stat_t)
	actualStat, actualOK := actual.Sys().(*syscall.Stat_t)
	return expectedOK && actualOK && expectedStat.Ctim == actualStat.Ctim
}
