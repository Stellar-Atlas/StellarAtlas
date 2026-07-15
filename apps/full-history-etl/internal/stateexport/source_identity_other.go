//go:build !linux

package stateexport

import "os"

func sameSourceChangeTime(os.FileInfo, os.FileInfo) bool {
	return true
}
