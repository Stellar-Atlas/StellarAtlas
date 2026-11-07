//go:build !linux

package backfill

func historyHoldMarkerReason(string) string {
	return "historical hold requires a root-controlled Linux runtime directory"
}
