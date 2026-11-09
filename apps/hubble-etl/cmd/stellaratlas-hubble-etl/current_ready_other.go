//go:build !linux

package main

import "errors"

func publishCurrentWriterReady(string, uint32, uint64) error {
	return errors.New("current writer readiness publication requires Linux and systemd")
}
