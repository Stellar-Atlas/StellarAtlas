package clickhouse

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
)

const (
	currentWriteOverhead         = 4096
	currentWriteMaxBytes         = 64 << 30
	currentWriteMaxRequests      = 1024
	currentWriteStatusCount      = 3
	currentWriteIndexStatusCount = 2
	currentWriteReservedRequests = currentWriteStatusCount + currentWriteIndexStatusCount
	currentWriteStatusBytes      = 16 << 10
	currentWriteStatusReserve    = currentWriteReservedRequests * currentWriteStatusBytes
)

// ErrCurrentWriteBudgetExceeded identifies a local byte or request limit refusal.
var ErrCurrentWriteBudgetExceeded = errors.New("ClickHouse current write budget exceeded")

type currentWriteBudgetKey struct{}

type currentWriteStage uint8
type currentWriteStatus uint8

const (
	currentWriteNoStage currentWriteStage = iota
	currentWriteHolderStage
	currentWritePoolStage
	currentWriteStageCount
)

const (
	currentWriteNoStatus currentWriteStatus = iota
	currentWriteIngestionStatus
	currentWriteReadModelStatus
	currentWriteStatusKinds
)

type currentWriteBudget struct {
	mu            sync.Mutex
	dataRemaining uint64
	dataChecks    uint16
	statusChecks  [currentWriteStatusKinds]uint8
	beforeInsert  func(context.Context) error
	stagedBytes   [currentWriteStageCount]uint64
	promoted      [currentWriteStageCount]bool
}

// WithCurrentWriteBudget guards the ClickHouse writes of one immutable File
// attempt. The limit is a logical write envelope, not a guarantee about
// physical ClickHouse disk usage. It includes a fixed manifest status reserve.
// beforeInsert must do a fresh read-only capacity check before each submission.
func WithCurrentWriteBudget(ctx context.Context, maxBytes uint64, beforeInsert func(context.Context) error) (context.Context, error) {
	if maxBytes <= currentWriteStatusReserve || maxBytes > currentWriteMaxBytes {
		return nil, fmt.Errorf("ClickHouse current write budget must be greater than %d bytes and no more than %d bytes", currentWriteStatusReserve, uint64(currentWriteMaxBytes))
	}
	if beforeInsert == nil {
		return nil, fmt.Errorf("ClickHouse current write budget requires a fresh capacity check")
	}
	budget := &currentWriteBudget{dataRemaining: maxBytes - currentWriteStatusReserve, beforeInsert: beforeInsert}
	return context.WithValue(ctx, currentWriteBudgetKey{}, budget), nil
}

// Only row-bearing FORMAT requests may use the generic INSERT path. A
// nonempty dummy body must not turn INSERT SELECT into an ordinary row insert.
var currentWriteRowQuery = regexp.MustCompile("^(`?[A-Za-z_][A-Za-z0-9_]*`?)( \\(`?[A-Za-z_][A-Za-z0-9_]*`?(, `?[A-Za-z_][A-Za-z0-9_]*`?)*\\))?( SETTINGS async_insert=0(, insert_deduplication_token=\\{token:String\\}, date_time_input_format='best_effort')?)? FORMAT (JSONEachRow|Native)$")

func isGuardedCurrentInsert(ctx context.Context, query string) bool {
	return ctx.Value(currentWriteBudgetKey{}) != nil && strings.HasPrefix(query, "INSERT INTO ")
}

func admitCurrentWrite(ctx context.Context, quotedDatabase, query string, bodyLen int) error {
	budget, _ := ctx.Value(currentWriteBudgetKey{}).(*currentWriteBudget)
	if budget == nil {
		return nil
	}
	read := strings.TrimSpace(query)
	if end := strings.IndexAny(read, " \t\r\n"); bodyLen == 0 && end >= 0 && strings.EqualFold(read[:end], "SELECT") {
		return nil
	}
	base := quotedDatabase
	tail, canonical := strings.CutPrefix(query, "INSERT INTO "+base+".")
	if !canonical {
		return fmt.Errorf("unsupported SQL under ClickHouse current write budget")
	}
	var stage currentWriteStage
	var promotion bool
	var status currentWriteStatus
	switch tail {
	case "_asset_holder_stage (asset_key, account_id, state, batch_id, source_sha256) FORMAT JSONEachRow":
		stage = currentWriteHolderStage
	case "_asset_pool_stage (pool_id,state,batch_id,source_sha256) FORMAT JSONEachRow":
		stage = currentWritePoolStage
	case "_asset_holder_current (asset_key, account_id, state) SELECT asset_key, account_id, max(state) FROM " + base +
		"._asset_holder_stage WHERE batch_id={batch:UUID} AND source_sha256={digest:String} GROUP BY asset_key, account_id":
		stage, promotion = currentWriteHolderStage, true
	case "_asset_pool_current (pool_id,state) SELECT pool_id,max(state) FROM " + base +
		"._asset_pool_stage WHERE batch_id={batch:UUID} AND source_sha256={digest:String} GROUP BY pool_id":
		stage, promotion = currentWritePoolStage, true
	case "_ingestion_batches SETTINGS async_insert=0 FORMAT JSONEachRow":
		status = currentWriteIngestionStatus
	case "_asset_holder_index_batches SETTINGS async_insert=0 FORMAT JSONEachRow":
		status = currentWriteReadModelStatus
	default:
		match := currentWriteRowQuery.FindStringSubmatch(tail)
		if match == nil {
			return fmt.Errorf("unsupported INSERT under ClickHouse current write budget")
		}
		switch strings.Trim(match[1], "`") {
		case "_ingestion_batches", "_asset_holder_index_batches", "_asset_holder_stage", "_asset_pool_stage", "_asset_holder_current", "_asset_pool_current":
			return fmt.Errorf("noncanonical manifest or read-model INSERT under ClickHouse current write budget")
		}
	}
	if promotion != (bodyLen == 0) {
		return fmt.Errorf("invalid INSERT body under ClickHouse current write budget")
	}
	return budget.charge(ctx, uint64(bodyLen), stage, promotion, status)
}

func (b *currentWriteBudget) charge(ctx context.Context, body uint64, stage currentWriteStage, promotion bool, status currentWriteStatus) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if promotion && (b.stagedBytes[stage] == 0 || b.promoted[stage]) {
		return fmt.Errorf("ClickHouse current promotion requires matching staged bytes and may run only once")
	}
	// Stage rows prepay their bounded grouped copy of the same staged tuple.
	// Promotion later charges only a separate fixed request overhead.
	multiplier := uint64(1)
	if stage != currentWriteNoStage && !promotion {
		multiplier = 2
	}
	if status != currentWriteNoStatus {
		maximum := uint8(currentWriteStatusCount)
		if status == currentWriteReadModelStatus {
			maximum = currentWriteIndexStatusCount
		}
		if b.statusChecks[status] >= maximum || body > currentWriteStatusBytes-currentWriteOverhead {
			return fmt.Errorf("%w: manifest status reserve", ErrCurrentWriteBudgetExceeded)
		}
		b.statusChecks[status]++
	} else {
		if b.dataChecks >= currentWriteMaxRequests-currentWriteReservedRequests {
			return fmt.Errorf("%w: data request limit", ErrCurrentWriteBudgetExceeded)
		}
		if b.dataRemaining < currentWriteOverhead || body > (b.dataRemaining-currentWriteOverhead)/multiplier {
			return fmt.Errorf("%w: data byte limit (body %d bytes, %d bytes remaining)", ErrCurrentWriteBudgetExceeded, body, b.dataRemaining)
		}
		b.dataChecks++
	}
	// Failed fresh checks use a request slot but send no HTTP and spend no data
	// bytes. Once charged, a request is never refunded after HTTP ambiguity.
	if err := b.beforeInsert(ctx); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if status == currentWriteNoStatus {
		b.dataRemaining -= body*multiplier + currentWriteOverhead
	}
	if promotion {
		b.promoted[stage] = true
	} else if stage != currentWriteNoStage {
		b.stagedBytes[stage] += body
	}
	return nil
}
