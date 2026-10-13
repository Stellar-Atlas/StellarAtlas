package publication

import (
	"encoding/json"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
)

const Subject = "stellaratlas.warehouse.published"
const maximumRecentBatchIDs = 1024

type Event struct {
	Version     int      `json:"version"`
	Event       string   `json:"event"`
	BatchID     string   `json:"batchId"`
	MinLedger   uint32   `json:"minLedger"`
	MaxLedger   uint32   `json:"maxLedger"`
	PublishedAt string   `json:"publishedAt"`
	Datasets    []string `json:"datasets"`
}

type WarehousePublisher struct {
	servers   []string
	token     string
	pending   chan Event
	stop      chan struct{}
	done      chan struct{}
	closeOnce sync.Once
	mu        sync.Mutex
	seen      map[string]struct{}
	recent    []string
}

func NewWarehousePublisher(servers, token string) *WarehousePublisher {
	values := strings.Split(servers, ",")
	clean := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			clean = append(clean, value)
		}
	}
	publisher := &WarehousePublisher{
		servers: clean, token: token, pending: make(chan Event, 1),
		stop: make(chan struct{}), done: make(chan struct{}), seen: make(map[string]struct{}),
	}
	go publisher.run()
	return publisher
}

// PublishBatch is a freshness hint, not a durable delivery guarantee.
// It keeps only the latest unsent batch and never blocks the ETL worker.
func (p *WarehousePublisher) PublishBatch(event Event) {
	if p == nil || event.BatchID == "" || event.MinLedger == 0 || event.MaxLedger < event.MinLedger {
		return
	}
	event.Version = 1
	event.Event = "datasets.published"
	event.Datasets = append([]string(nil), event.Datasets...)
	p.mu.Lock()
	if _, exists := p.seen[event.BatchID]; exists {
		p.mu.Unlock()
		return
	}
	p.seen[event.BatchID] = struct{}{}
	p.recent = append(p.recent, event.BatchID)
	if len(p.recent) > maximumRecentBatchIDs {
		delete(p.seen, p.recent[0])
		p.recent = p.recent[1:]
	}
	p.mu.Unlock()
	select {
	case p.pending <- event:
	default:
		select {
		case <-p.pending:
		default:
		}
		select {
		case p.pending <- event:
		default:
		}
	}
}

func (p *WarehousePublisher) Close() {
	if p == nil {
		return
	}
	p.closeOnce.Do(func() { close(p.stop) })
	<-p.done
}

func (p *WarehousePublisher) run() {
	defer close(p.done)
	backoff := time.Second
	lastErrorLog := time.Time{}
	logFailure := func(reason string) {
		if lastErrorLog.IsZero() || time.Since(lastErrorLog) >= 30*time.Second {
			log.Printf("warehouse publisher %s", reason)
			lastErrorLog = time.Now()
		}
	}
	for {
		select {
		case <-p.stop:
			return
		default:
		}
		if len(p.servers) == 0 {
			if !p.wait(backoff) {
				return
			}
			backoff = nextBackoff(backoff)
			continue
		}
		options := []nats.Option{
			nats.Name("stellaratlas-hubble-etl-warehouse-publisher"),
			nats.Timeout(2 * time.Second),
			nats.MaxReconnects(3),
			nats.ReconnectWait(500 * time.Millisecond),
		}
		if p.token != "" {
			options = append(options, nats.Token(p.token))
		}
		connection, err := nats.Connect(strings.Join(p.servers, ","), options...)
		if err != nil {
			logFailure("connection failed; retrying")
			if !p.wait(backoff) {
				return
			}
			backoff = nextBackoff(backoff)
			continue
		}
		closed := connection.StatusChanged(nats.CLOSED)
		reconnect := false
		for !reconnect {
			select {
			case <-p.stop:
				connection.RemoveStatusListener(closed)
				connection.Close()
				return
			case <-closed:
				reconnect = true
			case event := <-p.pending:
				payload, marshalErr := json.Marshal(event)
				if marshalErr != nil || connection.Publish(Subject, payload) != nil || connection.FlushTimeout(time.Second) != nil {
					logFailure("publication failed; reconnecting")
					connection.Close()
					reconnect = true
				}
			}
		}
		connection.Close()
		if !p.wait(backoff) {
			return
		}
		backoff = nextBackoff(backoff)
	}
}

func (p *WarehousePublisher) wait(duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-p.stop:
		return false
	case <-timer.C:
		return true
	}
}

func nextBackoff(value time.Duration) time.Duration {
	if value >= 30*time.Second {
		return 30 * time.Second
	}
	value *= 2
	if value > 30*time.Second {
		return 30 * time.Second
	}
	return value
}
