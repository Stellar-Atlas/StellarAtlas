package schema

import (
	"fmt"
	"reflect"
	"regexp"
	"strings"
	"time"
)

type Column struct {
	Name string
	Type string
}

var identifierPattern = regexp.MustCompile("^[a-z][a-z0-9_]*$")

var metadataColumns = []Column{
	{Name: "_batch_id", Type: "UUID"},
	{Name: "_source_sha256", Type: "FixedString(64)"},
	{Name: "_ledger_sequence", Type: "UInt32"},
	{Name: "_row_number", Type: "UInt64"},
	{Name: "_ingested_at", Type: "DateTime64(6, 'UTC')"},
}

func DatabaseSQL(database string) (string, error) {
	if !identifierPattern.MatchString(database) {
		return "", fmt.Errorf("invalid ClickHouse database %q", database)
	}
	return "CREATE DATABASE IF NOT EXISTS " + quote(database), nil
}

func IngestionTableSQL(database string) (string, error) {
	if !identifierPattern.MatchString(database) {
		return "", fmt.Errorf("invalid ClickHouse database %q", database)
	}
	return fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s._ingestion_batches (
	batch_id UUID,
	source_sha256 FixedString(64),
	start_ledger UInt32,
	end_ledger UInt32,
	ledger_count UInt32,
	row_count UInt64,
	status Enum8('started' = 1, 'complete' = 2, 'failed' = 3),
	error String,
	updated_at DateTime64(6, 'UTC')
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY batch_id`, quote(database)), nil
}

func TableSQL(database string, dataset Dataset) (string, error) {
	if !identifierPattern.MatchString(database) || !identifierPattern.MatchString(dataset.Name) {
		return "", fmt.Errorf("invalid ClickHouse identifier")
	}
	columns, err := Columns(dataset)
	if err != nil {
		return "", err
	}
	available := make(map[string]struct{}, len(columns))
	definitions := make([]string, 0, len(columns))
	for _, column := range columns {
		available[column.Name] = struct{}{}
		definitions = append(definitions, "\t"+quote(column.Name)+" "+column.Type)
	}
	order := append([]string(nil), dataset.OrderBy...)
	order = append(order, "_batch_id", "_row_number")
	orderFields := make([]string, 0, len(order))
	for _, field := range order {
		if _, ok := available[field]; !ok {
			return "", fmt.Errorf("%s order key %q is not a column", dataset.Name, field)
		}
		orderFields = append(orderFields, quote(field))
	}
	return fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s.%s (
%s
) ENGINE = ReplacingMergeTree(_ingested_at)
PARTITION BY intDiv(_ledger_sequence, 1048576)
ORDER BY (%s)
SETTINGS index_granularity = 8192, non_replicated_deduplication_window = 65536`,
		quote(database), quote(dataset.Name), strings.Join(definitions, ",\n"),
		strings.Join(orderFields, ", ")), nil
}

func Columns(dataset Dataset) ([]Column, error) {
	if dataset.RowType.Kind() != reflect.Struct {
		return nil, fmt.Errorf("%s row type must be a struct", dataset.Name)
	}
	columns := make([]Column, 0, dataset.RowType.NumField()+len(metadataColumns))
	seen := make(map[string]struct{})
	for i := 0; i < dataset.RowType.NumField(); i++ {
		field := dataset.RowType.Field(i)
		name := jsonName(field)
		if name == "" {
			continue
		}
		if !identifierPattern.MatchString(name) {
			return nil, fmt.Errorf("%s has invalid JSON field %q", dataset.Name, name)
		}
		if _, exists := seen[name]; exists {
			return nil, fmt.Errorf("%s has duplicate JSON field %q", dataset.Name, name)
		}
		columnType, err := clickHouseType(field.Type)
		if err != nil {
			return nil, fmt.Errorf("%s.%s: %w", dataset.Name, name, err)
		}
		seen[name] = struct{}{}
		columns = append(columns, Column{Name: name, Type: columnType})
	}
	for _, column := range metadataColumns {
		if _, exists := seen[column.Name]; exists {
			return nil, fmt.Errorf("%s conflicts with metadata column %q", dataset.Name, column.Name)
		}
		columns = append(columns, column)
	}
	return columns, nil
}

func jsonName(field reflect.StructField) string {
	tag := field.Tag.Get("json")
	name := strings.Split(tag, ",")[0]
	if name == "-" {
		return ""
	}
	if name == "" {
		name = field.Name
	}
	return name
}

func clickHouseType(t reflect.Type) (string, error) {
	if t == reflect.TypeOf(time.Time{}) {
		return "DateTime64(6, 'UTC')", nil
	}
	switch t.PkgPath() {
	case "github.com/guregu/null":
		switch t.Name() {
		case "Bool":
			return "Nullable(Bool)", nil
		case "Float":
			return "Nullable(Float64)", nil
		case "Int":
			return "Nullable(Int64)", nil
		case "String":
			return "Nullable(String)", nil
		}
	case "github.com/guregu/null/zero":
		switch t.Name() {
		case "Bool":
			return "Bool", nil
		case "Float":
			return "Float64", nil
		case "Int":
			return "Int64", nil
		case "String":
			return "String", nil
		}
	}
	switch t.Kind() {
	case reflect.Bool:
		return "Bool", nil
	case reflect.Int, reflect.Int64:
		return "Int64", nil
	case reflect.Int8:
		return "Int8", nil
	case reflect.Int16:
		return "Int16", nil
	case reflect.Int32:
		return "Int32", nil
	case reflect.Uint, reflect.Uint64:
		return "UInt64", nil
	case reflect.Uint8:
		return "UInt8", nil
	case reflect.Uint16:
		return "UInt16", nil
	case reflect.Uint32:
		return "UInt32", nil
	case reflect.Float32:
		return "Float32", nil
	case reflect.Float64:
		return "Float64", nil
	case reflect.String:
		return "String", nil
	case reflect.Pointer:
		inner, err := clickHouseType(t.Elem())
		if err != nil || strings.HasPrefix(inner, "Nullable(") || inner == "Dynamic" {
			return "Dynamic", nil
		}
		return "Nullable(" + inner + ")", nil
	case reflect.Slice:
		inner, err := clickHouseType(t.Elem())
		if err != nil || inner == "Dynamic" || strings.HasPrefix(inner, "Nullable(") {
			return "Dynamic", nil
		}
		return "Array(" + inner + ")", nil
	case reflect.Array, reflect.Interface, reflect.Map, reflect.Struct:
		return "Dynamic", nil
	default:
		return "", fmt.Errorf("unsupported Go type %s", t)
	}
}

func quote(value string) string {
	return "`" + value + "`"
}
