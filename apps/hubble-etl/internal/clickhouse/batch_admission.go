package clickhouse

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

const maximumBatchAdmissionIDs = 128

func (c *Client) BatchAdmissionFor(
	ctx context.Context,
	ids []string,
) (BatchAdmissionSnapshot, error) {
	state := BatchAdmissionSnapshot{
		Completed:  make(map[string]string),
		Incomplete: make(map[string]string),
	}
	if len(ids) == 0 {
		return state, nil
	}
	if len(ids) > maximumBatchAdmissionIDs {
		return state, fmt.Errorf("batch admission accepts at most 128 IDs")
	}
	placeholders := make([]string, len(ids))
	params := make(url.Values, len(ids))
	for index, id := range ids {
		if !uuidPattern.MatchString(id) {
			return state, fmt.Errorf("invalid immutable batch ID")
		}
		name := fmt.Sprintf("b%d", index)
		placeholders[index] = "{" + name + ":UUID}"
		params.Set("param_"+name, id)
	}
	query := "SELECT batch_id, source_sha256, status FROM " + quoted(c.database) +
		"._ingestion_batches FINAL WHERE batch_id IN (" +
		strings.Join(placeholders, ", ") + ") FORMAT JSONEachRow"
	body, err := c.execute(ctx, query, params, nil)
	if err != nil {
		return state, err
	}
	return decodeBatchAdmission(body)
}

func decodeBatchAdmission(body []byte) (BatchAdmissionSnapshot, error) {
	state := BatchAdmissionSnapshot{
		Completed:  make(map[string]string),
		Incomplete: make(map[string]string),
	}
	scanner := bufio.NewScanner(bytes.NewReader(body))
	scanner.Buffer(make([]byte, 64*1024), 1<<20)
	for scanner.Scan() {
		var row struct {
			BatchID      string `json:"batch_id"`
			SourceSHA256 string `json:"source_sha256"`
			Status       string `json:"status"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &row); err != nil {
			return state, fmt.Errorf("decode batch admission manifest: %w", err)
		}
		if !uuidPattern.MatchString(row.BatchID) ||
			!digestPattern.MatchString(row.SourceSHA256) {
			return state, fmt.Errorf("ClickHouse returned an invalid batch admission manifest")
		}
		switch row.Status {
		case "complete":
			state.Completed[row.BatchID] = row.SourceSHA256
		case "started", "failed":
			state.Incomplete[row.BatchID] = row.SourceSHA256
		default:
			return state, fmt.Errorf("ClickHouse returned an invalid batch status")
		}
	}
	if err := scanner.Err(); err != nil {
		return state, err
	}
	return state, nil
}
