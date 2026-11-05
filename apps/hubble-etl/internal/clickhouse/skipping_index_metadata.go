package clickhouse

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

type installedSkippingIndex struct {
	Table       string `json:"table"`
	Name        string `json:"name"`
	Type        string `json:"type"`
	TypeFull    string `json:"type_full"`
	Expression  string `json:"expr"`
	Granularity string `json:"granularity"`
}

type installedSkippingIndexes map[string]installedSkippingIndex

// This parser accepts only the small, fixed syntax emitted by SkippingIndexSQL.
var skippingIndexStatement = regexp.MustCompile("^ALTER TABLE `([A-Za-z_][A-Za-z0-9_]*)`\\.`([A-Za-z_][A-Za-z0-9_]*)` ADD INDEX IF NOT EXISTS `([A-Za-z_][A-Za-z0-9_]*)` `([A-Za-z_][A-Za-z0-9_]*)` TYPE (minmax|bloom_filter\\(0\\.01\\)) GRANULARITY ([1-9][0-9]*)$")

func (c *Client) loadSkippingIndexes(ctx context.Context) (installedSkippingIndexes, error) {
	body, err := c.execute(ctx, "SELECT table,name,type,type_full,expr,toString(granularity) AS granularity"+
		" FROM system.data_skipping_indices WHERE database={database:String} FORMAT JSON",
		url.Values{"param_database": {c.database}}, nil)
	if err != nil {
		return nil, fmt.Errorf("read installed skipping indexes: %w", err)
	}
	var response struct {
		Data []installedSkippingIndex `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decode installed skipping indexes: %w", err)
	}
	indexes := make(installedSkippingIndexes, len(response.Data))
	for _, index := range response.Data {
		key := index.Table + "." + index.Name
		if !identifierPattern.MatchString(index.Table) || !identifierPattern.MatchString(index.Name) {
			return nil, fmt.Errorf("invalid installed skipping-index identifier")
		}
		if _, duplicate := indexes[key]; duplicate {
			return nil, fmt.Errorf("duplicate installed skipping index %s", key)
		}
		indexes[key] = index
	}
	return indexes, nil
}

func (indexes installedSkippingIndexes) compatible(statement string) (bool, error) {
	parts := skippingIndexStatement.FindStringSubmatch(statement)
	if parts == nil {
		return false, fmt.Errorf("unexpected generated skipping-index definition")
	}
	index, exists := indexes[parts[2]+"."+parts[3]]
	if !exists {
		return false, nil
	}
	expression := strings.Trim(strings.TrimSpace(index.Expression), "`")
	fullType := strings.ReplaceAll(index.TypeFull, " ", "")
	typeMatches := index.Type == "minmax" && fullType == "minmax" && parts[5] == "minmax"
	if index.Type == "bloom_filter" && parts[5] == "bloom_filter(0.01)" && strings.HasPrefix(fullType, "bloom_filter(") && strings.HasSuffix(fullType, ")") {
		probability, err := strconv.ParseFloat(strings.TrimSuffix(strings.TrimPrefix(fullType, "bloom_filter("), ")"), 64)
		typeMatches = err == nil && !math.IsNaN(probability) && math.Abs(probability-0.01) < 1e-12
	}
	if expression != parts[4] || index.Granularity != parts[6] || !typeMatches {
		return false, fmt.Errorf("installed skipping index %s.%s differs from generated schema; refusing automatic ALTER", parts[2], parts[3])
	}
	return true, nil
}
