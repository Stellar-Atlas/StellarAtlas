package clickhouse

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"
)

type insertResponseMetadata struct {
	elapsedNanoseconds *uint64
	writtenRows        *uint64
	writtenBytes       *uint64
}

// Summary metadata is optional: malformed input never becomes a request error.
// Only the three allowlisted top-level counters escape this bounded parser.
func parseInsertResponseMetadata(header http.Header) insertResponseMetadata {
	var raw string
	values := 0
	for name, entries := range header {
		if !strings.EqualFold(name, "X-ClickHouse-Summary") {
			continue
		}
		values += len(entries)
		if values > 1 {
			return insertResponseMetadata{}
		}
		if len(entries) == 1 {
			raw = entries[0]
		}
	}
	if values != 1 || len(raw) > 4096 || !utf8.ValidString(raw) {
		return insertResponseMetadata{}
	}

	decoder := json.NewDecoder(strings.NewReader(raw))
	start, err := decoder.Token()
	if err != nil || start != json.Delim('{') {
		return insertResponseMetadata{}
	}
	var result insertResponseMetadata
	var seen uint8
	for decoder.More() {
		key, err := decoder.Token()
		if err != nil {
			return insertResponseMetadata{}
		}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return insertResponseMetadata{}
		}
		var destination **uint64
		var bit uint8
		switch key {
		case "elapsed_ns":
			destination, bit = &result.elapsedNanoseconds, 1
		case "written_rows":
			destination, bit = &result.writtenRows, 2
		case "written_bytes":
			destination, bit = &result.writtenBytes, 4
		default:
			continue
		}
		if seen&bit != 0 {
			return insertResponseMetadata{}
		}
		seen |= bit
		*destination = parseInsertResponseUint64(value)
	}
	end, err := decoder.Token()
	if err != nil || end != json.Delim('}') {
		return insertResponseMetadata{}
	}
	if _, err := decoder.Token(); err != io.EOF {
		return insertResponseMetadata{}
	}
	return result
}

func parseInsertResponseUint64(raw json.RawMessage) *uint64 {
	if len(raw) >= 2 && raw[0] == '"' && raw[len(raw)-1] == '"' {
		raw = raw[1 : len(raw)-1]
	}
	if len(raw) == 0 {
		return nil
	}
	for _, digit := range raw {
		if digit < '0' || digit > '9' {
			return nil
		}
	}
	value, err := strconv.ParseUint(string(raw), 10, 64)
	if err != nil {
		return nil
	}
	return &value
}
