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
	// Endpoint comes from operator configuration, not query parameters or input rows.
	Endpoint string
	User     string
	Password string
	Database string
	// A nil Transport uses the shared direct transport, without environment
	// proxies. An explicit Transport is trusted to route ClickHouse requests.
	HTTPClient                *http.Client
	HolderIndexEnabled        bool
	HolderIndexStoragePolicy  string
	SingleCopyOperations      bool
	VirtualLedgerTransactions bool
	AutoStorageLayout         bool
}

type Client struct {
	endpoint                  *url.URL
	user                      string
	password                  string
	database                  string
	http                      *http.Client
	holderIndexEnabled        bool
	holderIndexStoragePolicy  string
	singleCopyOperations      bool
	virtualLedgerTransactions bool
	autoStorageLayout         bool
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
	// Declared projector outputs, not proof of full target readback validation.
	ExpectedDatasetRows map[string]uint64 `json:"expected_dataset_rows,omitempty"`
	ProjectionContract  string            `json:"projection_contract,omitempty"`
}

var (
	digestPattern     = regexp.MustCompile("^[0-9a-f]{64}$")
	identifierPattern = regexp.MustCompile("^[A-Za-z_][A-Za-z0-9_]{0,63}$")
	tokenPattern      = regexp.MustCompile("^[A-Za-z0-9:_-]{1,240}$")
	uuidPattern       = regexp.MustCompile("^[0-9a-fA-F-]{36}$")
)

var directHTTPTransport = func() *http.Transport {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	// Do not send warehouse credentials or row data through an ambient proxy.
	transport.Proxy = nil
	return transport
}()

func New(config Config) (*Client, error) {
	endpoint, err := url.Parse(config.Endpoint)
	if err != nil || (endpoint.Scheme != "http" && endpoint.Scheme != "https") ||
		endpoint.Hostname() == "" || endpoint.User != nil || endpoint.Opaque != "" ||
		strings.Contains(config.Endpoint, "#") {
		return nil, fmt.Errorf("invalid ClickHouse endpoint")
	}
	if _, err := url.ParseQuery(endpoint.RawQuery); err != nil {
		return nil, fmt.Errorf("invalid ClickHouse endpoint query")
	}
	if _, err := schema.DatabaseSQL(config.Database); err != nil {
		return nil, err
	}
	storagePolicy := config.HolderIndexStoragePolicy
	if storagePolicy == "" {
		storagePolicy = "stellar_read_models"
	}
	if !identifierPattern.MatchString(storagePolicy) {
		return nil, fmt.Errorf("invalid holder-index storage policy")
	}
	httpClient := http.Client{Timeout: 2 * time.Minute}
	if config.HTTPClient != nil {
		httpClient = *config.HTTPClient
	}
	if httpClient.Transport == nil {
		httpClient.Transport = directHTTPTransport
	}
	// Never replay SQL, row data, or credentials to a redirect target.
	httpClient.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	return &Client{
		endpoint:                  endpoint,
		user:                      config.User,
		password:                  config.Password,
		database:                  config.Database,
		http:                      &httpClient,
		holderIndexEnabled:        config.HolderIndexEnabled,
		holderIndexStoragePolicy:  storagePolicy,
		singleCopyOperations:      config.SingleCopyOperations,
		virtualLedgerTransactions: config.VirtualLedgerTransactions,
		autoStorageLayout:         config.AutoStorageLayout,
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
	var installedIndexes installedSkippingIndexes
	if c.autoStorageLayout {
		if err := c.detectStorageLayout(ctx); err != nil {
			return err
		}
		var err error
		installedIndexes, err = c.loadSkippingIndexes(ctx)
		if err != nil {
			return err
		}
	}
	ingestionSQL, _ := schema.IngestionTableSQL(c.database)
	if _, err := c.execute(ctx, ingestionSQL, nil, nil); err != nil {
		return fmt.Errorf("create ingestion table: %w", err)
	}
	// Metadata-only defaults leave historical rows explicitly undeclared.
	ingestionColumnsSQL := "ALTER TABLE " + quoted(c.database) + "._ingestion_batches" +
		" ADD COLUMN IF NOT EXISTS expected_dataset_rows Map(String, UInt64) DEFAULT map()," +
		" ADD COLUMN IF NOT EXISTS projection_contract LowCardinality(String) DEFAULT ''"
	if _, err := c.execute(ctx, ingestionColumnsSQL, nil, nil); err != nil {
		return fmt.Errorf("add ingestion projection metadata: %w", err)
	}
	for _, dataset := range schema.Datasets() {
		if c.virtualLedgerTransactions && dataset.Name == "ledger_transactions" {
			if err := c.checkVirtualLedgerTransactions(ctx); err != nil {
				return err
			}
			continue
		}
		tableSQL, err := c.tableSQL(dataset)
		if err != nil {
			return err
		}
		if _, err := c.execute(ctx, tableSQL, nil, nil); err != nil {
			return fmt.Errorf("create %s: %w", dataset.Name, err)
		}
		if c.singleCopyOperations && dataset.Name == "history_operations" {
			if err := c.checkSingleCopyOperations(ctx); err != nil {
				return err
			}
		}
		indexStatements, err := schema.SkippingIndexSQL(c.database, dataset)
		if err != nil {
			return err
		}
		for _, statement := range indexStatements {
			if c.autoStorageLayout {
				exists, err := installedIndexes.compatible(statement)
				if err != nil {
					return err
				}
				if exists {
					continue
				}
			}
			if _, err := c.execute(ctx, statement, nil, nil); err != nil {
				return fmt.Errorf("add %s query index: %w", dataset.Name, err)
			}
		}
	}
	if c.holderIndexEnabled {
		if err := c.InitializeHolderIndex(ctx); err != nil {
			return err
		}
	}
	return nil
}

func (c *Client) Insert(ctx context.Context, table, token string, rows []byte) error {
	return c.insert(ctx, table, token, rows, nil)
}

// Timings belong to one serial batch writer, never the shared client.
type insertTimings struct {
	// Only the existing encode/send path sets this; it does not assert that
	// every row decoded or any request was acknowledged.
	encoderAttempted bool
	responses        insertResponseTotals
	nativeEncode     time.Duration
	request          time.Duration
	poolWait         time.Duration
	upload           time.Duration
	firstByteWait    time.Duration
	bodyRead         time.Duration
	permitWait       time.Duration
}

func (c *Client) insert(ctx context.Context, table, token string, rows []byte, timings *insertTimings) error {
	if c.virtualLedgerTransactions && table == "ledger_transactions" {
		return fmt.Errorf("virtual ledger_transactions cannot accept physical INSERTs")
	}
	dataset, ok := schema.Lookup(table)
	if !ok {
		return fmt.Errorf("unknown Hubble table %q", table)
	}
	if !tokenPattern.MatchString(token) {
		return fmt.Errorf("invalid insertion token")
	}
	columns, err := schema.Columns(dataset)
	if err != nil {
		return err
	}
	columnList := ""
	if c.singleCopyOperations && table == "history_operations" {
		columns = operationInsertColumns(columns)
		names := make([]string, len(columns))
		for i, column := range columns {
			names[i] = quoted(column.Name)
		}
		columnList = " (" + strings.Join(names, ", ") + ")"
		token += ":single-copy-v1"
	}
	format := "JSONEachRow"
	if timings != nil {
		timings.encoderAttempted = true
	}
	if hasDynamicColumns(columns) {
		started := time.Now()
		rows, err = encodeNativeRowsParallel(columns, rows)
		if timings != nil {
			timings.nativeEncode += time.Since(started)
		}
		if err != nil {
			return fmt.Errorf("encode %s: %w", table, err)
		}
		format = "Native"
		token += ":native-v1"
		if !tokenPattern.MatchString(token) {
			return fmt.Errorf("versioned insertion token too long")
		}
	}
	query := "INSERT INTO " + quoted(c.database) + "." + quoted(table) +
		columnList +
		" SETTINGS async_insert=0, insert_deduplication_token={token:String}," +
		" date_time_input_format='best_effort' FORMAT " + format
	params := url.Values{"param_token": []string{token}}
	started := time.Now()
	_, err = c.executeTimed(ctx, query, params, rows, timings)
	if timings != nil {
		timings.request += time.Since(started)
	}
	if err != nil {
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
) (result []byte, finalErr error) {
	return c.executeTimed(ctx, query, params, body, nil)
}

func (c *Client) executeTimed(ctx context.Context, query string, params url.Values, body []byte, timings *insertTimings) (result []byte, finalErr error) {
	defer func() {
		if finalErr != nil {
			finalErr = &RequestError{Err: finalErr}
		}
	}()
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.endpoint.String(),
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}
	// Attach payload values after parsing the trusted endpoint; no input can
	// change the scheme, authority, or path.
	values := request.URL.Query()
	values.Set("query", query)
	for key, entries := range params {
		for _, entry := range entries {
			values.Add(key, entry)
		}
	}
	if isGuardedCurrentInsert(ctx, query) {
		// Pin the per-query setting for auxiliary INSERT SELECT as well as
		// ordinary payload INSERTs, without changing historical queries.
		values.Set("async_insert", "0")
	}
	request.URL.RawQuery = values.Encode()
	if c.user != "" {
		request.SetBasicAuth(c.user, c.password)
	}
	request.Header.Set("Content-Type", "application/octet-stream")
	if err := admitCurrentWrite(ctx, quoted(c.database), query, len(body)); err != nil {
		return nil, err
	}
	if timings != nil {
		var finish func()
		request, finish = traceInsertRequest(request, timings)
		defer finish()
	}
	var response *http.Response
	if timings != nil {
		// One logical HTTP call, not a count of internal transport retries.
		// Observations never affect the existing request/result path.
		defer func() {
			var metadata insertResponseMetadata
			if response != nil {
				metadata = parseInsertResponseMetadata(response.Header)
			}
			timings.responses.observe(metadata, finalErr != nil)
		}()
	}
	response, err = c.http.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	readStarted := time.Now()
	responseBody, readErr := io.ReadAll(io.LimitReader(response.Body, 32<<20))
	if timings != nil {
		timings.bodyRead += time.Since(readStarted)
	}
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
		if !uuidPattern.MatchString(row.BatchID) || !digestPattern.MatchString(row.SourceSHA256) {
			return nil, fmt.Errorf("ClickHouse returned an invalid completed batch")
		}
		completed[row.BatchID] = row.SourceSHA256
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return completed, nil
}

type BatchAdmissionSnapshot struct {
	Completed  map[string]string
	Incomplete map[string]string
}

func (c *Client) BatchAdmissionState(ctx context.Context) (BatchAdmissionSnapshot, error) {
	state := BatchAdmissionSnapshot{Completed: make(map[string]string), Incomplete: make(map[string]string)}
	query := "SELECT batch_id, source_sha256, status FROM " + quoted(c.database) +
		"._ingestion_batches FINAL FORMAT JSONEachRow"
	body, err := c.execute(ctx, query, nil, nil)
	if err != nil {
		return state, err
	}
	return decodeBatchAdmission(body)
}
