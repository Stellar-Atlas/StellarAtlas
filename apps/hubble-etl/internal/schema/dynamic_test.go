package schema

import "testing"

func TestContractEventTopicsUseDynamic(t *testing.T) {
	t.Parallel()
	dataset, ok := Lookup("history_contract_events")
	if !ok {
		t.Fatal("history_contract_events dataset is missing")
	}
	columns, err := Columns(dataset)
	if err != nil {
		t.Fatal(err)
	}
	for _, column := range columns {
		if column.Name != "topics" {
			continue
		}
		if column.Type != "Dynamic" {
			t.Fatalf("topics type is %s, want Dynamic", column.Type)
		}
		return
	}
	t.Fatal("history_contract_events.topics column is missing")
}
