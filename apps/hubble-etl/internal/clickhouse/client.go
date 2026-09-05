package clickhouse

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/schema"
)

type Config struct {
	Endpoint   string
	User       string
	Password   string
	Database   string
	HTTPClient *http.Client
}

type Client struct {
	endpoint *url.URL
	user     string
	password string
	database string
	http     *http.Client
}

type BatchStatus struct {
	BatchID      string `json:"batch_id"`
	SourceSHA256 string `json:"source_sha256"`
	StartLedger  uint32 `json:"start_ledger"`
	EndLedger    uint32 `json:"end_ledger"`
	LedgerCount  uint32 `json:"ledger_count"`
	RowCount     uint64 `json:"row_count"`
	Status       string `json:"status"`
	Error        string `json:"error"`
	UpdatedAt    string `json:"updated_at"`
}

var (
	digestPattern = regexp.MustCompile("^[0-9a-f]{64}$")
	tokenPattern  = regexp.MustCompile("^[A-Za-z0-9:_-]{1,240}$")
	uuidPattern   = regexp.MustCompile("^[0-9a-fA-F-]{36}$")
)

func New(config Config) (*Client, error) {
	endpoint, err := url.Parse(config.Endpoint)
	if err != nil || (endpoint.Scheme != "http" && endpoint.Scheme != "https") ||
		endpoint.Host == "" {
		return nil, fmt.Errorf("invalid ClickHouse endpoint")
	}
	if _, err := schema.DatabaseSQL(config.Database); err != nil {
		return nil, err
	}
	httpClient := config.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 2 * time.Minute}
	}
	return &Client{
		endpoint: endpoint,
		user:     config.User,
		password: config.Password,
		database: config.Database,
		http:     httpClient,
	}, nil
}

func (c *Client) Database() string {
	return c.database
}

func (c *Client) Initialize(ctx context.Context) error {
	databaseSQL, _ := schema.DatabaseSQL(c.database)
	if _, err := c.execute(ctx, databaseSQL, nil, nil); err != nil {
		return fmt.Errorf("create Hubble database: %w", err)
	}
	ingestionSQL, _ := schema.IngestionTableSQL(c.database)
	if _, err := c.execute(ctx, ingestionSQL, nil, nil); err != nil {
		return fmt.Errorf("create ingestion table: %w", err)
	}
	for _, dataset := range schema.Datasets() {
		tableSQL, err := schema.TableSQL(c.database, dataset)
		if err != nil {
			return err
		}
		if _, err := c.execute(ctx, tableSQL, nil, nil); err != nil {
			return fmt.Errorf("create %s: %w", dataset.Name, err)
		}
		indexStatements, err := schema.SkippingIndexSQL(c.database, dataset)
		if err != nil {
			return err
		}
		for _, statement := range indexStatements {
			if _, err := c.execute(ctx, statement, nil, nil); err != nil {
				return fmt.Errorf("add %s query index: %w", dataset.Name, err)
			}
		}
	}
	return nil
}

func (c *Client) Insert(ctx context.Context, table, token string, rows []byte) error {
	if _, ok := schema.Lookup(table); !ok {
		return fmt.Errorf("unknown Hubble table %q", table)
	}
	if !tokenPattern.MatchString(token) {
		return fmt.Errorf("invalid insertion token")
	}
	query := "INSERT INTO " + quoted(c.database) + "." + quoted(table) +
		" SETTINGS async_insert=0, insert_deduplication_token={token:String}," +
		" date_time_input_format='best_effort' FORMAT JSONEachRow"
	params := url.Values{"param_token": []string{token}}
	if _, err := c.execute(ctx, query, params, rows); err != nil {
		return fmt.Errorf("insert %s: %w", table, err)
	}
	return nil
}

func (c *Client) BatchComplete(
	ctx context.Context,
	batchID, sourceSHA256 string,
) (bool, error) {
	if !uuidPattern.MatchString(batchID) || !digestPattern.MatchString(sourceSHA256) {
		return false, fmt.Errorf("invalid immutable batch identity")
	}
	query := "SELECT count() FROM " + quoted(c.database) +
		"._ingestion_batches FINAL WHERE batch_id={batch:UUID}" +
		" AND source_sha256={digest:String} AND status='complete' FORMAT TabSeparated"
	params := url.Values{
		"param_batch":  []string{batchID},
		"param_digest": []string{sourceSHA256},
	}
	body, err := c.execute(ctx, query, params, nil)
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(string(body)) == "1", nil
}

func (c *Client) RecordBatch(ctx context.Context, status BatchStatus) error {
	if !uuidPattern.MatchString(status.BatchID) ||
		!digestPattern.MatchString(status.SourceSHA256) {
		return fmt.Errorf("invalid immutable batch status")
	}
	switch status.Status {
	case "started", "complete", "failed":
	default:
		return fmt.Errorf("invalid batch status %q", status.Status)
	}
	payload, err := json.Marshal(status)
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	query := "INSERT INTO " + quoted(c.database) +
		"._ingestion_batches SETTINGS async_insert=0 FORMAT JSONEachRow"
	if _, err := c.execute(ctx, query, nil, payload); err != nil {
		return fmt.Errorf("record batch status: %w", err)
	}
	return nil
}

func (c *Client) execute(
	ctx context.Context,
	query string,
	params url.Values,
	body []byte,
) ([]byte, error) {
	requestURL := *c.endpoint
	values := requestURL.Query()
	values.Set("query", query)
	for key, entries := range params {
		for _, entry := range entries {
			values.Add(key, entry)
		}
	}
	requestURL.RawQuery = values.Encode()
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		requestURL.String(),
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}
	if c.user != "" {
		request.SetBasicAuth(c.user, c.password)
	}
	request.Header.Set("Content-Type", "application/octet-stream")
	response, err := c.http.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	responseBody, readErr := io.ReadAll(io.LimitReader(response.Body, 32<<20))
	if readErr != nil {
		return nil, readErr
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf(
			"ClickHouse HTTP %d: %s",
			response.StatusCode,
			strings.TrimSpace(string(responseBody)),
		)
	}
	return responseBody, nil
}

func quoted(value string) string {
	return "`" + value + "`"
}
func (c *Client) CompletedBatches(ctx context.Context) (map[string]string, error) {
	query := "SELECT batch_id, source_sha256 FROM " + quoted(c.database) +
		"._ingestion_batches FINAL WHERE status='complete' FORMAT JSONEachRow"
	body, err := c.execute(ctx, query, nil, nil)
	if err != nil {
		return nil, err
	}
	completed := make(map[string]string)
	scanner := bufio.NewScanner(bytes.NewReader(body))
	scanner.Buffer(make([]byte, 64*1024), 1<<20)
	for scanner.Scan() {
		var row struct {
			BatchID      string `json:"batch_id"`
			SourceSHA256 string `json:"source_sha256"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &row); err != nil {
			return nil, fmt.Errorf("decode completed batch: %w", err)
		}
		if !uuidPattern.MatchString(row.BatchID) ||
			!digestPattern.MatchString(row.SourceSHA256) {
			return nil, fmt.Errorf("ClickHouse returned an invalid completed batch")
		}
		completed[row.BatchID] = row.SourceSHA256
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return completed, nil
}
