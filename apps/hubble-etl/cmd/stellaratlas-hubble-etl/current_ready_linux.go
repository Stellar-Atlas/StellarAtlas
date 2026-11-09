package main

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"syscall"
)

var (
	currentWriterInvocationPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)
	currentWriterBootPattern       = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
)

type currentWriterReadyRecord struct {
	Version           int    `json:"version"`
	BootID            string `json:"bootId"`
	InvocationID      string `json:"invocationId"`
	PID               int    `json:"pid"`
	StartTicks        string `json:"startTicks"`
	MinimumLedger     uint32 `json:"minimumLedger"`
	MaximumWriteBytes string `json:"maximumWriteBytes"`
}

func publishCurrentWriterReady(path string, minimumLedger uint32, budget uint64) error {
	invocation := os.Getenv("INVOCATION_ID")
	if !currentWriterInvocationPattern.MatchString(invocation) {
		return fmt.Errorf("missing or invalid systemd invocation ID")
	}
	boot, err := os.ReadFile("/proc/sys/kernel/random/boot_id")
	if err != nil {
		return fmt.Errorf("read boot ID: %w", err)
	}
	bootID := strings.TrimSuffix(string(boot), "\n")
	if !currentWriterBootPattern.MatchString(bootID) {
		return fmt.Errorf("invalid kernel boot ID")
	}
	stat, err := os.ReadFile("/proc/self/stat")
	if err != nil {
		return fmt.Errorf("read current writer process stat: %w", err)
	}
	startTicks, err := parseCurrentWriterStartTicks(string(stat))
	if err != nil {
		return err
	}
	if path != filepath.Clean(path) || !strings.HasPrefix(path, "/run/") {
		return fmt.Errorf("current writer readiness file must be a canonical absolute path under /run")
	}
	parent := filepath.Dir(path)
	if parent == "/run" || !slices.Contains(strings.Split(os.Getenv("RUNTIME_DIRECTORY"), ":"), parent) {
		return fmt.Errorf("current writer readiness parent must be the systemd runtime directory")
	}
	resolved, err := filepath.EvalSymlinks(parent)
	if err != nil {
		return fmt.Errorf("resolve current writer readiness parent: %w", err)
	}
	if resolved != parent {
		return fmt.Errorf("current writer readiness parent must not contain symlinks")
	}
	info, err := os.Lstat(parent)
	if err != nil {
		return fmt.Errorf("stat current writer readiness parent: %w", err)
	}
	owner, ok := info.Sys().(*syscall.Stat_t)
	if !info.IsDir() || info.Mode().Perm()&0o022 != 0 || !ok || owner.Uid != uint32(os.Geteuid()) {
		return fmt.Errorf("current writer readiness parent must be a private-write directory owned by the writer")
	}
	root, err := os.OpenRoot(parent)
	if err != nil {
		return fmt.Errorf("open current writer readiness parent: %w", err)
	}
	defer root.Close()
	dir, err := root.Open(".")
	if err != nil {
		return fmt.Errorf("open current writer readiness directory for sync: %w", err)
	}
	defer dir.Close()
	opened, err := dir.Stat()
	if err != nil {
		return fmt.Errorf("verify current writer readiness parent: %w", err)
	}
	if !os.SameFile(info, opened) || opened.Mode().Perm()&0o022 != 0 {
		return fmt.Errorf("current writer readiness parent changed while opening")
	}
	record := currentWriterReadyRecord{
		Version: 1, BootID: bootID, InvocationID: invocation, PID: os.Getpid(), StartTicks: startTicks,
		MinimumLedger: minimumLedger, MaximumWriteBytes: strconv.FormatUint(budget, 10),
	}
	return writeCurrentWriterReady(root, dir, filepath.Base(path), record)
}

func parseCurrentWriterStartTicks(stat string) (string, error) {
	// The process name (field 2) can itself contain spaces and right parentheses.
	if end := strings.LastIndexByte(stat, ')'); end >= 0 && strings.Contains(stat[:end], " (") {
		fields := strings.Fields(stat[end+1:]) // fields 3 onward
		if len(fields) > 19 {
			ticks := fields[19] // field 22
			if value, err := strconv.ParseUint(ticks, 10, 64); err == nil && value != 0 && strconv.FormatUint(value, 10) == ticks {
				return ticks, nil
			}
		}
	}
	return "", fmt.Errorf("invalid current writer process start ticks")
}

func writeCurrentWriterReady(root *os.Root, dir *os.File, name string, record currentWriterReadyRecord) error {
	temp := ".current-writer-ready-" + rand.Text()
	file, err := root.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("create current writer readiness temporary file: %w", err)
	}
	defer func() { _ = root.Remove(temp) }()
	defer file.Close()
	if err := json.NewEncoder(file).Encode(record); err != nil {
		return fmt.Errorf("write current writer readiness record: %w", err)
	}
	if err := file.Chmod(0o644); err != nil {
		return fmt.Errorf("set current writer readiness record mode: %w", err)
	}
	if err := file.Sync(); err != nil {
		return fmt.Errorf("sync current writer readiness record: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close current writer readiness record: %w", err)
	}
	// A stale marker, including a symlink, must never be followed or replaced.
	if err := root.Link(temp, name); err != nil {
		return fmt.Errorf("publish current writer readiness record without replacing an existing marker: %w", err)
	}
	if err := root.Remove(temp); err != nil {
		return fmt.Errorf("remove current writer readiness temporary name: %w", err)
	}
	if err := dir.Sync(); err != nil {
		return fmt.Errorf("sync current writer readiness directory: %w", err)
	}
	return nil
}
