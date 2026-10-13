package publication

import (
	"bufio"
	"net"
	"strings"
	"testing"
	"time"
)

func TestPublishBatchSuppressesRecentDuplicate(t *testing.T) {
	publisher := &WarehousePublisher{
		pending: make(chan Event, 1),
		seen:    make(map[string]struct{}),
	}
	event := Event{BatchID: "batch-1", MinLedger: 10, MaxLedger: 20, Datasets: []string{"accounts"}}
	publisher.PublishBatch(event)
	publisher.PublishBatch(event)
	if len(publisher.pending) != 1 {
		t.Fatalf("duplicate batch queued more than once: pending=%d", len(publisher.pending))
	}
	queued := <-publisher.pending
	if queued.Version != 1 || queued.Event != "datasets.published" || queued.BatchID != event.BatchID {
		t.Fatalf("unexpected queued publication: %#v", queued)
	}
}

func TestPublisherConnectsEagerly(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	connected := make(chan error, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			connected <- err
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
		if _, err := conn.Write([]byte("INFO {\"server_id\":\"test\",\"version\":\"2.10.7\",\"proto\":1,\"max_payload\":1048576}\r\n")); err != nil {
			connected <- err
			return
		}
		reader := bufio.NewReader(conn)
		sawConnect := false
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				connected <- err
				return
			}
			if strings.HasPrefix(line, "CONNECT ") {
				sawConnect = true
			}
			if line == "PING\r\n" {
				if _, err := conn.Write([]byte("PONG\r\n")); err != nil {
					connected <- err
					return
				}
				if !sawConnect {
					connected <- errMissingConnect
					return
				}
				connected <- nil
				return
			}
		}
	}()

	publisher := NewWarehousePublisher("nats://"+listener.Addr().String(), "")
	defer publisher.Close()
	select {
	case err := <-connected:
		if err != nil {
			t.Fatalf("publisher did not connect eagerly: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("publisher did not connect eagerly")
	}
}

var errMissingConnect = &missingConnectError{}

type missingConnectError struct{}

func (*missingConnectError) Error() string { return "NATS CONNECT line was not sent" }
