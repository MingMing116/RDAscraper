package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testApp(t *testing.T) *app {
	t.Helper()
	return &app{host: "127.0.0.1:8765", token: token(), dataDir: t.TempDir(), cache: map[string]cacheItem{}, slots: make(chan struct{}, 6), shutdown: make(chan struct{}), logger: log.New(io.Discard, "", 0), client: remoteClient()}
}
func call(a *app, method, path, body, auth string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://"+a.host+path, strings.NewReader(body))
	r.Header.Set("X-RDA-Token", auth)
	w := httptest.NewRecorder()
	a.handlers().ServeHTTP(w, r)
	return w
}
func TestEmbeddedRuntime(t *testing.T) {
	a := testApp(t)
	for _, p := range []string{"/", "/app.mjs", "/documents.mjs", "/news.mjs", "/style.css", "/assets/NanumGothic.ttf", "/assets/isaki.png", "/vendor/pdf.mjs", "/vendor/pdf.worker.mjs", "/vendor/wasm/openjpeg.wasm", "/vendor/pako.min.js", "/media_master.json", "/ocr.mjs", "/assets/NanumGothic-Bold.ttf", "/vendor/ocr/tesseract.min.js", "/vendor/ocr/worker.min.js", "/vendor/ocr/lang/kor.traineddata.gz", "/vendor/ocr/lang/eng.traineddata.gz", "/vendor/ocr/core/tesseract-core-lstm.wasm.js", "/vendor/ocr/core/tesseract-core-simd-lstm.wasm.js", "/vendor/ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js"} {
		r := call(a, "GET", p, "", "")
		if r.Code != 200 || r.Body.Len() == 0 {
			t.Fatalf("embedded %s: %d", p, r.Code)
		}
	}
	if r := call(a, "GET", "/app.mjs", "", ""); r.Header().Get("Content-Type") != "application/javascript" {
		t.Fatal("module MIME")
	}
	for _, p := range []string{"/vendor/", "/unknown", "/assets/"} {
		if call(a, "GET", p, "", "").Code != 404 {
			t.Fatalf("directory/missing %s", p)
		}
	}
}
func TestLocalGuardsAndToken(t *testing.T) {
	a := testApp(t)
	for _, h := range []map[string]string{{"Host": "attacker.invalid"}, {"Origin": "https://attacker.invalid"}, {"Sec-Fetch-Site": "cross-site"}} {
		r := httptest.NewRequest("GET", "http://"+a.host+"/api/config", nil)
		for k, v := range h {
			if k == "Host" {
				r.Host = v
			} else {
				r.Header.Set(k, v)
			}
		}
		w := httptest.NewRecorder()
		a.handlers().ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatal(h, w.Code)
		}
	}
	for _, p := range []string{"/api/project", "/api/diagnostics"} {
		if call(a, "GET", p, "", "").Code != 403 {
			t.Fatal("missing token", p)
		}
	}
	for _, p := range []string{"/api/project", "/api/fetch", "/api/shutdown"} {
		if call(a, "POST", p, "{}", "bad").Code != 403 {
			t.Fatal("wrong token", p)
		}
	}
	if call(a, "GET", "/api/config", "", "").Code != 200 {
		t.Fatal("config")
	}
	if call(a, "GET", "/api/health", "", "").Code != 200 {
		t.Fatal("health")
	}
	if token() == token() {
		t.Fatal("token collision")
	}
}
func TestProjectSaveReplaceRestore(t *testing.T) {
	a := testApp(t)
	if !strings.Contains(call(a, "GET", "/api/project", "", a.token).Body.String(), `"project":null`) {
		t.Fatal("new session")
	}
	for _, v := range []string{`{"schema":"rdascraper-project","version":62,"savedAt":1,"press":{"text":"한글 작업"},"results":[],"start":"2026-01-01","end":"2026-01-15"}`, `{"schema":"rdascraper-project","version":62,"savedAt":2,"press":{"text":"수정 작업"},"results":[],"start":"2026-01-01","end":"2026-01-15"}`} {
		if r := call(a, "POST", "/api/project", v, a.token); r.Code != 200 {
			t.Fatal(r.Body.String())
		}
		stored, e := os.ReadFile(filepath.Join(a.dataDir, "last-project.json"))
		normalized, _ := sanitizeProject([]byte(v))
		if e != nil || string(stored) != string(normalized) {
			t.Fatal("disk save", e)
		}
	}
	b := testApp(t)
	b.dataDir = a.dataDir
	if !strings.Contains(call(b, "GET", "/api/project", "", b.token).Body.String(), "수정 작업") {
		t.Fatal("restored across new app")
	}
	for _, v := range []string{"{broken", `{"schema":"other"}`} {
		if call(a, "POST", "/api/project", v, a.token).Code != 400 {
			t.Fatal("invalid accepted")
		}
	}
	files, _ := filepath.Glob(filepath.Join(a.dataDir, ".project-*"))
	if len(files) != 0 {
		t.Fatal("temporary files leaked")
	}
	os.WriteFile(filepath.Join(a.dataDir, "last-project.json"), []byte("broken"), 0600)
	if call(a, "GET", "/api/project", "", a.token).Code != 500 {
		t.Fatal("corruption hidden")
	}
}
func TestURLBoundaries(t *testing.T) {
	for _, s := range []string{"file:///etc/passwd", "https://u:p@example.com", "http://127.0.0.1", "http://[::1]", "http://192.168.1.1", "http://10.0.0.1", "http://169.254.169.254", "http://100.64.0.1", "http://198.18.0.1", "https://93.184.216.34:444"} {
		if _, e := validateURL(context.Background(), s); e == nil {
			t.Fatal("accepted", s)
		}
	}
	if _, e := validateURL(context.Background(), "https://93.184.216.34/news?id=1"); e != nil {
		t.Fatal(e)
	}
	if publicIP(net.ParseIP("fc00::1")) {
		t.Fatal("IPv6 private")
	}
}

type roundFunc func(*http.Request) (*http.Response, error)

func (f roundFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestFetchEncodingCacheAndLimits(t *testing.T) {
	a := testApp(t)
	count := 0
	a.client = &http.Client{Transport: roundFunc(func(r *http.Request) (*http.Response, error) {
		count++
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/html; charset=euc-kr"}}, Body: io.NopCloser(bytes.NewReader([]byte{'<', 'p', '>', 0xb0, 0xa1, '<', '/', 'p', '>'})), Request: r}, nil
	})}
	got := a.fetch(context.Background(), "https://93.184.216.34/news")
	if !got.OK || got.Text != "<p>가</p>" {
		t.Fatalf("charset %+v", got)
	}
	got = a.fetch(context.Background(), "https://93.184.216.34/news")
	if !got.Cached || count != 1 {
		t.Fatal("cache")
	}
	a.client = &http.Client{Transport: roundFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 429, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("blocked")), Request: r}, nil
	})}
	got = a.fetch(context.Background(), "https://93.184.216.34/blocked")
	if got.OK || got.Status != 429 {
		t.Fatal("limit hidden")
	}
	a.client = &http.Client{Transport: roundFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/html"}}, Body: io.NopCloser(strings.NewReader(strings.Repeat("x", maxPage+1))), Request: r}, nil
	})}
	got = a.fetch(context.Background(), "https://93.184.216.34/large")
	if got.OK || !strings.Contains(got.Error, "5MB") {
		t.Fatal("size", got.Error)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	a.slots = make(chan struct{})
	if a.fetch(ctx, "https://93.184.216.34/cancel").OK {
		t.Fatal("cancel ignored")
	}
}
func TestSingleInstanceAndHealth(t *testing.T) {
	dir := t.TempDir()
	unlock, first, e := singleInstance(dir)
	if e != nil || !first {
		t.Fatal("first", e)
	}
	defer unlock()
	release, second, e := singleInstance(dir)
	if release != nil {
		defer release()
	}
	if e != nil || second {
		t.Fatal("duplicate", e)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"ok": true, "app": "RDAscraper", "version": version})
	}))
	defer server.Close()
	if !localReady(server.URL) {
		t.Fatal("readiness")
	}
	if localReady("https://example.com") {
		t.Fatal("remote readiness")
	}
}
func TestShutdownIsIdempotent(t *testing.T) {
	a := testApp(t)
	for i := 0; i < 2; i++ {
		if call(a, "POST", "/api/shutdown", "{}", a.token).Code != 200 {
			t.Fatal("shutdown")
		}
	}
	select {
	case <-a.shutdown:
	default:
		t.Fatal("not signaled")
	}
}

func TestResetSnapshotSurvivesRestart(t *testing.T) {
	a := testApp(t)
	old := `{"schema":"rdascraper-project","version":63,"savedAt":100,"press":{"title":"old","text":"old document"},"results":[],"start":"2026-01-01","end":"2026-01-15"}`
	blank := `{"schema":"rdascraper-project","version":63,"savedAt":200,"press":null,"results":[],"reset":true}`
	for _, v := range []string{old, blank} {
		if call(a, "POST", "/api/project", v, a.token).Code != 200 {
			t.Fatal("save")
		}
	}
	b := testApp(t)
	b.dataDir = a.dataDir
	r := call(b, "GET", "/api/project", "", b.token)
	if r.Code != 200 || strings.Contains(r.Body.String(), "old") || !strings.Contains(r.Body.String(), `"press":null`) {
		t.Fatal(r.Body.String())
	}
}
