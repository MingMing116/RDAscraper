package main

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestExportRefreshSkipsCachedArticle(t *testing.T) {
	a := testApp(t)
	calls := 0
	a.client = &http.Client{Transport: roundFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		body := "<html><meta charset=utf-8><article>처음 본문</article></html>"
		if calls > 1 {
			body = "<html><meta charset=utf-8><article>갱신된 전체 본문</article></html>"
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/html; charset=utf-8"}}, Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	})}
	url := "https://93.184.216.34/article"
	first := a.fetch(context.Background(), url)
	cached := a.fetch(context.Background(), url)
	fresh := a.fetchFresh(context.Background(), url, true)
	if !first.OK || !cached.Cached || fresh.Cached || calls != 2 || !strings.Contains(fresh.Text, "갱신된 전체 본문") {
		t.Fatalf("refresh did not bypass only cached response: calls=%d fresh=%+v", calls, fresh)
	}
	if a.fetchFresh(context.Background(), "http://127.0.0.1/private", true).OK || calls != 2 {
		t.Fatal("refresh bypassed target policy")
	}
}

func TestExportManualBodyProjectRoundTrip(t *testing.T) {
	a := testApp(t)
	data := `{"schema":"rdascraper-project","version":64,"savedAt":1,"press":{"text":"농촌진흥청 연구 보도자료"},"results":[{"title":"기사 제목","url":"https://example.com/news","body":"원문을 보고 보완한 본문","bodyUserEdited":true,"bodySource":"사용자 보완"}],"start":"2026-06-01","end":"2026-06-30"}`
	r := call(a, "POST", "/api/project", data, a.token)
	if r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	stored := call(a, "GET", "/api/project", "", a.token).Body.String()
	if !strings.Contains(stored, `"bodyUserEdited":true`) || !strings.Contains(stored, "사용자 보완") {
		t.Fatal("manual body provenance lost")
	}
}
