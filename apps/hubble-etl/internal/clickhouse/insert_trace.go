package clickhouse

import (
	"net/http"
	"net/http/httptrace"
	"sync"
	"time"
)

func (t *insertTimings) add(other insertTimings) {
	t.nativeEncode += other.nativeEncode
	t.request += other.request
	t.poolWait += other.poolWait
	t.upload += other.upload
	t.firstByteWait += other.firstByteWait
	t.bodyRead += other.bodyRead
	t.permitWait += other.permitWait
}

// Hooks may run concurrently, or after Do returns on an early response. Only
// completed, ordered phase pairs are counted; missing phases remain zero.
// GetConn starts a new attempt, so a transport retry cannot pair old events.
func traceInsertRequest(request *http.Request, timings *insertTimings) (*http.Request, func()) {
	var mu sync.Mutex
	var getConn, gotConn, wrote time.Time
	var firstByte, closed bool
	var totals insertTimings
	hook := func(update func(time.Time)) {
		now := time.Now()
		mu.Lock()
		defer mu.Unlock()
		if !closed {
			update(now)
		}
	}
	trace := &httptrace.ClientTrace{
		GetConn: func(string) {
			hook(func(now time.Time) {
				getConn, gotConn, wrote, firstByte = now, time.Time{}, time.Time{}, false
			})
		},
		GotConn: func(httptrace.GotConnInfo) {
			hook(func(now time.Time) {
				if !getConn.IsZero() && !now.Before(getConn) {
					totals.poolWait += now.Sub(getConn)
				}
				getConn, gotConn, wrote = time.Time{}, now, time.Time{}
			})
		},
		WroteRequest: func(info httptrace.WroteRequestInfo) {
			hook(func(now time.Time) {
				if info.Err == nil && !gotConn.IsZero() && !now.Before(gotConn) {
					totals.upload += now.Sub(gotConn)
					if !firstByte {
						wrote = now
					}
				}
				gotConn = time.Time{}
			})
		},
		GotFirstResponseByte: func() {
			hook(func(now time.Time) {
				if !firstByte && !wrote.IsZero() && !now.Before(wrote) {
					totals.firstByteWait += now.Sub(wrote)
				}
				firstByte, wrote = true, time.Time{}
			})
		},
	}
	ctx := httptrace.WithClientTrace(request.Context(), trace)
	return request.WithContext(ctx), func() {
		mu.Lock()
		defer mu.Unlock()
		closed = true
		timings.add(totals)
	}
}
