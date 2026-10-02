package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/html/charset"
)

// All runtime assets are compiled into the executable, with no unpack or installer.
//
//go:embed web
var assets embed.FS

const version = "65.3.1"
const maxPage = 5 << 20
const maxProject = 15 << 20

type fetched struct {
	OK     bool   `json:"ok"`
	Status int    `json:"status,omitempty"`
	URL    string `json:"url,omitempty"`
	Text   string `json:"text,omitempty"`
	Error  string `json:"error,omitempty"`
	Cached bool   `json:"cached,omitempty"`
}
type cacheItem struct {
	page fetched
	at   time.Time
}
type app struct {
	token, host, dataDir string
	server               *http.Server
	client               *http.Client
	projectMu            sync.Mutex
	cacheMu              sync.Mutex
	cache                map[string]cacheItem
	cacheEpoch           uint64
	slots                chan struct{}
	shutdown             chan struct{}
	once                 sync.Once
	logger               *log.Logger
	logWriter            *rotatingLog
}

func token() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func send(w http.ResponseWriter, v any, status int) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, msg string) {
	send(w, map[string]any{"ok": false, "error": msg}, status)
}
func (a *app) fetch(ctx context.Context, raw string) fetched {
	return a.fetchFresh(ctx, raw, false)
}

func (a *app) fetchFresh(ctx context.Context, raw string, refresh bool) fetched {
	a.cacheMu.Lock()
	saved, exists := a.cache[raw]
	epoch := a.cacheEpoch
	a.cacheMu.Unlock()
	if !refresh && exists && time.Since(saved.at) < 3*time.Minute {
		p := saved.page
		p.Cached = true
		return p
	}
	select {
	case a.slots <- struct{}{}:
		defer func() { <-a.slots }()
	case <-ctx.Done():
		return fetched{Error: "요청이 중단되었습니다"}
	}
	ctx, cancel := context.WithTimeout(ctx, 18*time.Second)
	defer cancel()
	u, err := validateURL(ctx, raw)
	if err != nil {
		return fetched{Error: err.Error()}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return fetched{Error: err.Error()}
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 RDAscraper/"+version)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "ko-KR,ko;q=0.9,en;q=0.5")
	response, err := a.client.Do(req)
	if err != nil {
		return fetched{Error: safeConnectionError(err)}
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 400 {
		return fetched{Status: response.StatusCode, Error: fmt.Sprintf("HTTP %d: 사이트에서 요청을 허용하지 않거나 응답하지 않았습니다", response.StatusCode)}
	}
	ct := response.Header.Get("Content-Type")
	if ct != "" && !strings.Contains(ct, "text") && !strings.Contains(ct, "xml") && !strings.Contains(ct, "json") {
		return fetched{Error: "HTML 기사 또는 뉴스 검색 주소를 입력하세요"}
	}
	rawBytes, err := io.ReadAll(io.LimitReader(response.Body, maxPage+1))
	if err != nil {
		return fetched{Error: "기사 본문을 끝까지 읽지 못했습니다"}
	}
	if len(rawBytes) > maxPage {
		return fetched{Error: "본문 응답이 5MB를 초과했습니다"}
	}
	reader, err := charset.NewReader(bytes.NewReader(rawBytes), ct)
	if err != nil {
		return fetched{Error: "본문 문자 인코딩을 읽지 못했습니다"}
	}
	decoded, err := io.ReadAll(io.LimitReader(reader, 3*maxPage+1))
	if err != nil {
		return fetched{Error: "본문 문자를 변환하지 못했습니다"}
	}
	result := fetched{OK: true, Status: response.StatusCode, URL: response.Request.URL.String(), Text: string(decoded)}
	a.cacheMu.Lock()
	if len(a.cache) >= 80 {
		a.cache = make(map[string]cacheItem)
	}
	if epoch == a.cacheEpoch {
		a.cache[raw] = cacheItem{result, time.Now()}
	}
	a.cacheMu.Unlock()
	return result
}
func (a *app) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob:; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
		if r.Host != a.host {
			fail(w, 403, "이 PC의 프로그램 주소로 접속하세요")
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+a.host {
			fail(w, 403, "외부 페이지의 요청은 허용하지 않습니다")
			return
		}
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			fail(w, 403, "외부 페이지의 요청은 허용하지 않습니다")
			return
		}
		next.ServeHTTP(w, r)
	})
}
func (a *app) authorized(w http.ResponseWriter, r *http.Request) bool {
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-RDA-Token")), []byte(a.token)) != 1 {
		fail(w, 403, "프로그램을 다시 열어 연결을 확인하세요")
		return false
	}
	return true
}
func (a *app) handlers() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		send(w, map[string]any{"ok": true, "app": "RDAscraper", "version": version, "mode": "single-exe"}, 200)
	})
	mux.HandleFunc("GET /api/config", func(w http.ResponseWriter, r *http.Request) {
		a.projectMu.Lock()
		autoSave := a.autoSaveEnabled()
		a.projectMu.Unlock()
		send(w, map[string]any{"ok": true, "app": "RDAscraper", "version": version, "mode": "single-exe", "token": a.token, "autoSave": autoSave}, 200)
	})
	mux.HandleFunc("POST /api/fetch", func(w http.ResponseWriter, r *http.Request) {
		if !a.authorized(w, r) {
			return
		}
		var input struct {
			URL     string `json:"url"`
			Refresh bool   `json:"refresh"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 24000)).Decode(&input); err != nil {
			fail(w, 400, "기사 주소 요청이 올바르지 않습니다")
			return
		}
		result := a.fetchFresh(r.Context(), input.URL, input.Refresh)
		if !result.OK {
			a.logger.Printf("network request_failed status=%d", result.Status)
		}
		send(w, result, 200)
	})
	mux.HandleFunc("GET /api/project", func(w http.ResponseWriter, r *http.Request) {
		if !a.authorized(w, r) {
			return
		}
		a.projectMu.Lock()
		defer a.projectMu.Unlock()
		f, err := os.Open(filepath.Join(a.dataDir, "last-project.json"))
		if os.IsNotExist(err) {
			send(w, map[string]any{"ok": true, "project": nil}, 200)
			return
		}
		if err != nil {
			fail(w, 500, "이전 작업 파일을 읽지 못했습니다")
			return
		}
		defer f.Close()
		data, err := io.ReadAll(io.LimitReader(f, maxProject+1))
		if err != nil {
			fail(w, 500, "이전 작업 파일을 읽지 못했습니다")
			return
		}
		data, err = sanitizeProject(data)
		if err != nil {
			fail(w, 500, "이전 작업 파일의 형식이 올바르지 않습니다. 로컬 작업 지우기로 초기화하세요")
			return
		}
		send(w, map[string]any{"ok": true, "project": json.RawMessage(data)}, 200)
	})
	mux.HandleFunc("POST /api/project", func(w http.ResponseWriter, r *http.Request) {
		if !a.authorized(w, r) {
			return
		}
		data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxProject))
		if err == nil {
			data, err = sanitizeProject(data)
		}
		if err != nil {
			fail(w, 400, "작업 파일 형식 또는 크기를 확인하세요")
			return
		}
		a.projectMu.Lock()
		defer a.projectMu.Unlock()
		if !a.autoSaveEnabled() {
			fail(w, 409, "자동 저장이 꺼져 있습니다. 작업 JSON을 직접 다운로드해 보관하세요")
			return
		}
		if err = writeAtomic(filepath.Join(a.dataDir, "last-project.json"), data); err != nil {
			fail(w, 500, "PC 자동 저장 실패. 작업 JSON을 다운로드해 보관하세요")
			return
		}
		send(w, map[string]any{"ok": true}, 200)
	})
	mux.HandleFunc("DELETE /api/project", func(w http.ResponseWriter, r *http.Request) {
		if !a.authorized(w, r) {
			return
		}
		a.projectMu.Lock()
		defer a.projectMu.Unlock()
		project, err := a.disableAutoSave()
		if err != nil {
			fail(w, 500, "자동 저장 설정 또는 로컬 작업 지우기를 완료하지 못했습니다")
			return
		}
		send(w, map[string]any{"ok": true, "autoSave": false, "project": project}, 200)
	})
	mux.HandleFunc("POST /api/preferences", func(w http.ResponseWriter, r *http.Request) {
		if !a.authorized(w, r) {
			return
		}
		var input struct {
			AutoSave *bool `json:"autoSave"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
		decoder.DisallowUnknownFields()
		err := decoder.Decode(&input)
		var tail any
		if err != nil || input.AutoSave == nil || decoder.Decode(&tail) != io.EOF {
			fail(w, 400, "자동 저장 설정이 올바르지 않습니다")
			return
		}
		a.projectMu.Lock()
		defer a.projectMu.Unlock()
		if !*input.AutoSave {
			project, err := a.disableAutoSave()
			if err != nil {
				fail(w, 500, "자동 저장 설정 또는 로컬 작업 지우기를 완료하지 못했습니다")
				return
			}
			send(w, map[string]any{"ok": true, "autoSave": false, "project": project}, 200)
			return
		}
		if err := writeAtomic(filepath.Join(a.dataDir, "preferences.json"), []byte(`{"autoSave":true}`)); err != nil {
			fail(w, 500, "자동 저장 설정을 저장하지 못했습니다")
			return
		}
		send(w, map[string]any{"ok": true, "autoSave": true}, 200)
	})
	mux.HandleFunc("POST /api/shutdown", func(w http.ResponseWriter, r *http.Request) {
		if !a.authorized(w, r) {
			return
		}
		send(w, map[string]any{"ok": true}, 200)
		a.once.Do(func() { close(a.shutdown) })
	})
	mux.HandleFunc("GET /api/diagnostics", func(w http.ResponseWriter, r *http.Request) {
		if !a.authorized(w, r) {
			return
		}
		send(w, map[string]any{"ok": true, "version": version, "mode": "single-exe", "address": "http://" + a.host, "dataFolder": a.dataDir}, 200)
	})
	web, _ := fs.Sub(assets, "web")
	static := http.FileServer(http.FS(web))
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p == "" {
			p = "index.html"
		}
		if !fs.ValidPath(p) {
			http.NotFound(w, r)
			return
		}
		info, err := fs.Stat(web, p)
		if err != nil || info.IsDir() {
			http.NotFound(w, r)
			return
		}
		if strings.HasSuffix(p, ".mjs") {
			w.Header().Set("Content-Type", "application/javascript")
		}
		if strings.HasSuffix(p, ".wasm") {
			w.Header().Set("Content-Type", "application/wasm")
		}
		if strings.HasSuffix(p, ".html") || strings.HasSuffix(p, ".css") || strings.HasSuffix(p, ".mjs") {
			w.Header().Set("Cache-Control", "no-store")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		static.ServeHTTP(w, r)
	})
	return a.guard(mux)
}

func main() {
	port := flag.Int("port", 8765, "local port; 0 chooses a free port")
	noBrowser := flag.Bool("no-browser", false, "do not open a browser")
	dataDir := flag.String("data-dir", "", "local application data folder")
	flag.Parse()
	if *dataDir == "" {
		base, e := os.UserConfigDir()
		if e != nil {
			base = os.TempDir()
		}
		*dataDir = filepath.Join(base, "RDAscraper")
	}
	if err := os.MkdirAll(*dataDir, 0700); err != nil {
		showError("작업 폴더를 만들지 못했습니다: " + err.Error())
		return
	}
	startupContext, cancelStartup := context.WithTimeout(context.Background(), 12*time.Second)
	unlock, existing, err := waitForInstance(startupContext, *dataDir)
	cancelStartup()
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			showError("기존 RDAscraper가 실행 중이지만 화면 연결을 확인하지 못했습니다.\n\n열린 RDAscraper 화면이 있으면 작업을 저장하고 프로그램 안의 '종료'를 누르세요.\n화면도 열리지 않으면 작업 관리자에서 RDAscraper.exe만 종료한 뒤 다시 실행하세요. 저장하지 않은 작업은 사라질 수 있습니다.")
		} else {
			showError("프로그램 실행 확인 실패: " + err.Error())
		}
		return
	}
	if existing.Address != "" {
		if *noBrowser {
			return
		}
		if err := openBrowser(existing.Address); err != nil {
			showError("기존 프로그램에 연결했습니다. 브라우저에서 이 주소를 여세요:\n" + existing.Address)
			return
		}
		if existing.Version == version || !confirmUpgrade() {
			return
		}
		replacementContext, cancelReplacement := context.WithTimeout(context.Background(), 12*time.Second)
		unlock, existing, err = waitForReplacement(replacementContext, *dataDir, version)
		cancelReplacement()
		if err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				showError("이전 프로그램이 아직 종료되지 않아 새 화면을 열지 않았습니다.\n\n열린 RDAscraper 화면에서 '작업 저장'을 누르고, 프로그램 안의 '종료'를 누른 뒤 새 실행파일을 다시 실행하세요.\n브라우저 창만 닫으면 프로그램은 계속 실행될 수 있습니다. 기존 작업은 변경하지 않았습니다.")
			} else {
				showError("새 프로그램 실행 확인 실패: " + err.Error())
			}
			return
		}
		if existing.Address != "" {
			if err := openBrowser(existing.Address); err != nil {
				showError("새 프로그램에 연결했습니다. 브라우저에서 이 주소를 여세요:\n" + existing.Address)
			}
			return
		}
	}
	if unlock != nil {
		defer unlock()
	}
	addressPath := filepath.Join(*dataDir, "address.txt")
	// We own the profile lock now. A previous crash may have left an address
	// whose port has since been reused; never publish it during this startup.
	if err := os.Remove(addressPath); err != nil && !os.IsNotExist(err) {
		showError("이전 연결 주소를 정리하지 못했습니다. 작업 폴더의 쓰기 권한을 확인한 뒤 다시 실행하세요.")
		return
	}
	logfile, err := openRotatingLog(filepath.Join(*dataDir, "RDAscraper.log"))
	if err != nil {
		showError("실행 기록을 만들지 못했습니다: " + err.Error())
		return
	}
	defer logfile.Close()
	logger := log.New(io.MultiWriter(os.Stdout, logfile), "", log.LstdFlags)
	listener, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		listener, err = net.Listen("tcp4", "127.0.0.1:0")
	}
	if err != nil {
		showError("PC 내부 연결을 시작하지 못했습니다: " + err.Error())
		return
	}
	a := &app{host: listener.Addr().String(), token: token(), dataDir: *dataDir, cache: map[string]cacheItem{}, slots: make(chan struct{}, 6), client: remoteClient(), shutdown: make(chan struct{}), logger: logger, logWriter: logfile}
	a.server = &http.Server{Handler: a.handlers(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 25 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 40 * time.Second}
	go func() {
		err := a.server.Serve(listener)
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Print(err)
			a.once.Do(func() { close(a.shutdown) })
		}
	}()
	address := "http://" + a.host + "/"
	ready := false
	for n := 0; n < 25; n++ {
		if localReady(address) {
			ready = true
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if !ready {
		_ = a.server.Close()
		showError("화면을 준비하지 못했습니다. 다시 실행하세요.")
		return
	}
	if err := writeAtomic(addressPath, []byte(address)); err != nil {
		_ = a.server.Close()
		showError("프로그램 연결 주소를 저장하지 못했습니다. 작업 폴더의 쓰기 권한을 확인한 뒤 다시 실행하세요.")
		return
	}
	logger.Printf("RDAscraper %s READY %s single-exe", version, address)
	if !*noBrowser {
		if err := openBrowser(address); err != nil {
			showError("브라우저에서 이 주소를 여세요:\n" + address)
		}
	}
	interrupt := make(chan os.Signal, 1)
	signal.Notify(interrupt, os.Interrupt)
	defer signal.Stop(interrupt)
	select {
	case <-a.shutdown:
	case <-interrupt:
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = a.server.Shutdown(ctx)
	_ = os.Remove(addressPath)
	logger.Print("RDAscraper stopped")
}
