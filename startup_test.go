package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func startupHealthServer(t *testing.T, instanceVersion string) *httptest.Server {
	t.Helper()
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/health" {
			t.Errorf("unexpected startup probe: %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "app": "RDAscraper", "version": instanceVersion})
	}))
	t.Cleanup(s.Close)
	return s
}

func startupWriteAddress(t *testing.T, dir, address string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, "address.txt"), []byte(address), 0600); err != nil {
		t.Fatal(err)
	}
}

func TestStartupProbeAcceptsOlderHealthyVersion(t *testing.T) {
	// Updating the executable must not make a healthy older process look dead.
	for _, v := range []string{"64.0.0", version} {
		t.Run(v, func(t *testing.T) {
			s := startupHealthServer(t, v)
			instance, err := probeLocalInstance(s.URL)
			if err != nil || instance.Address != s.URL+"/" || instance.Version != v {
				t.Fatalf("healthy instance not recognized: %+v, %v", instance, err)
			}
			if !localReady(s.URL) {
				t.Fatal("healthy older/current instance is not ready")
			}
		})
	}
}

func TestStartupProbeRejectsUnhealthyResponses(t *testing.T) {
	valid := `{"ok":true,"app":"RDAscraper","version":"64.0.0"}`
	cases := []struct {
		name   string
		status int
		body   string
	}{
		{"wrong application", http.StatusOK, `{"ok":true,"app":"unrelated-service","version":"64.0.0"}`},
		{"missing version", http.StatusOK, `{"ok":true,"app":"RDAscraper"}`},
		{"empty version", http.StatusOK, `{"ok":true,"app":"RDAscraper","version":""}`},
		{"not ready", http.StatusOK, `{"ok":false,"app":"RDAscraper","version":"64.0.0"}`},
		{"missing readiness", http.StatusOK, `{"app":"RDAscraper","version":"64.0.0"}`},
		{"error status with valid body", http.StatusServiceUnavailable, valid},
		{"malformed JSON", http.StatusOK, `{`},
		{"oversized JSON", http.StatusOK, strings.Repeat(" ", 1<<20) + valid},
		{"oversized version", http.StatusOK, `{"ok":true,"app":"RDAscraper","version":"` + strings.Repeat("x", 65) + `"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = fmt.Fprint(w, tc.body)
			}))
			defer s.Close()
			if instance, err := probeLocalInstance(s.URL); err == nil {
				t.Fatalf("unhealthy service recognized: %+v", instance)
			}
		})
	}
}

func TestStartupProbeNeverFollowsRedirects(t *testing.T) {
	var redirected atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		redirected.Add(1)
		_, _ = fmt.Fprint(w, `{"ok":true,"app":"RDAscraper","version":"64.0.0"}`)
	}))
	defer target.Close()
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusFound)
	}))
	defer s.Close()
	if instance, err := probeLocalInstance(s.URL); err == nil {
		t.Fatalf("redirect accepted as an instance: %+v", instance)
	}
	if redirected.Load() != 0 {
		t.Fatal("startup probe followed a redirect")
	}
}

func TestStartupProbeRejectsInvalidAddressesBeforeRequest(t *testing.T) {
	var requests atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		_, _ = fmt.Fprint(w, `{"ok":true,"app":"RDAscraper","version":"64.0.0"}`)
	}))
	defer s.Close()
	u, err := url.Parse(s.URL)
	if err != nil {
		t.Fatal(err)
	}
	for _, address := range []string{
		"", "not a URL", "http://127.0.0.1", "http://127.0.0.1:0", "http://127.0.0.1:65536",
		"http://127.0.0.1:http", "https://" + u.Host, "http://localhost:" + u.Port(),
		"http://127.0.0.2:" + u.Port(), "http://[::1]:" + u.Port(),
		"http://user@" + u.Host, s.URL + "/different-path", s.URL + "?secret=value", s.URL + "#fragment",
	} {
		t.Run(address, func(t *testing.T) {
			if instance, err := probeLocalInstance(address); err == nil {
				t.Fatalf("invalid address recognized: %+v", instance)
			}
		})
	}
	if requests.Load() != 0 {
		t.Fatalf("invalid addresses reached local server %d times", requests.Load())
	}
}

func TestStartupWaitFindsHealthyOlderLockedInstance(t *testing.T) {
	dir := t.TempDir()
	unlock, owner, err := singleInstance(dir)
	if err != nil || !owner {
		t.Fatalf("initial owner: %v, %v", owner, err)
	}
	defer unlock()
	s := startupHealthServer(t, "64.0.0")
	startupWriteAddress(t, dir, s.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	release, existing, err := waitForInstance(ctx, dir)
	if release != nil {
		defer release()
		t.Fatal("waiter became owner while a healthy instance holds the lock")
	}
	if err != nil || existing.Address != s.URL+"/" || existing.Version != "64.0.0" {
		t.Fatalf("existing older instance not found: %+v, %v", existing, err)
	}
}

func TestStartupWaitAcquiresAfterOwnerExitsBeforeAddressPublished(t *testing.T) {
	dir := t.TempDir()
	unlock, owner, err := singleInstance(dir)
	if err != nil || !owner {
		t.Fatalf("initial owner: %v, %v", owner, err)
	}
	// Ensure the handle is released even if the waiter exits unexpectedly.
	defer func() {
		if unlock != nil {
			unlock()
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	type result struct {
		release  func()
		existing localInstance
		err      error
	}
	completed := make(chan result, 1)
	go func() {
		r, e, err := waitForInstance(ctx, dir)
		completed <- result{r, e, err}
	}()
	select {
	case got := <-completed:
		if got.release != nil {
			got.release()
		}
		t.Fatalf("waiter stopped before owner exited: %+v, %v", got.existing, got.err)
	case <-time.After(100 * time.Millisecond):
	}
	unlock()
	unlock = nil
	select {
	case got := <-completed:
		if got.release != nil {
			defer got.release()
		}
		if got.err != nil || got.release == nil || got.existing.Address != "" {
			t.Fatalf("waiter did not acquire released lock: %+v, %v", got.existing, got.err)
		}
	case <-ctx.Done():
		t.Fatal("waiter failed to recover after original process exited")
	}
}

func TestStartupWaitTimeoutNeverStealsLockOrLeavesDuplicateHandle(t *testing.T) {
	dir := t.TempDir()
	unlock, owner, err := singleInstance(dir)
	if err != nil || !owner {
		t.Fatalf("initial owner: %v, %v", owner, err)
	}
	defer func() {
		if unlock != nil {
			unlock()
		}
	}()
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "starting", http.StatusServiceUnavailable)
	}))
	defer s.Close()
	startupWriteAddress(t, dir, s.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 350*time.Millisecond)
	defer cancel()
	release, existing, err := waitForInstance(ctx, dir)
	if release != nil {
		release()
		t.Fatal("waiter stole the owner's lock")
	}
	if err == nil || ctx.Err() == nil || existing.Address != "" {
		t.Fatalf("unhealthy owner should time out: %+v, %v (context %v)", existing, err, ctx.Err())
	}
	duplicate, acquired, err := singleInstance(dir)
	if duplicate != nil {
		duplicate()
	}
	if err != nil || acquired {
		t.Fatalf("owner's lock no longer exclusive: %v, %v", acquired, err)
	}
	unlock()
	unlock = nil
	// On Windows, leaked handles from duplicate checks keep the named mutex
	// alive after the true owner exits and prevent every future startup.
	recovered, acquired, err := singleInstance(dir)
	if recovered != nil {
		defer recovered()
	}
	if err != nil || !acquired || recovered == nil {
		t.Fatalf("duplicate checks kept the lock alive: %v, %v", acquired, err)
	}
}

func TestStartupSimultaneousLaunchesHaveExactlyOneOwner(t *testing.T) {
	dir := t.TempDir()
	const workers = 8
	start := make(chan struct{})
	type result struct {
		release  func()
		existing localInstance
		err      error
	}
	completed := make(chan result, workers)
	for i := 0; i < workers; i++ {
		go func() {
			<-start
			ctx, cancel := context.WithTimeout(context.Background(), 800*time.Millisecond)
			defer cancel()
			r, e, err := waitForInstance(ctx, dir)
			completed <- result{r, e, err}
		}()
	}
	close(start)
	owners := 0
	for i := 0; i < workers; i++ {
		got := <-completed
		if got.release != nil {
			owners++
			defer got.release()
			if got.err != nil {
				t.Errorf("owner returned error: %v", got.err)
			}
		} else if got.err == nil {
			t.Error("non-owner returned success without a running instance")
		}
		if got.existing.Address != "" {
			t.Errorf("invented existing instance: %+v", got.existing)
		}
	}
	if owners != 1 {
		t.Fatalf("simultaneous startups acquired %d owners, want 1", owners)
	}
}

func TestStartupIgnoresStaleAddressWhenLockIsFree(t *testing.T) {
	dir := t.TempDir()
	var probes atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		probes.Add(1)
		_, _ = fmt.Fprint(w, `{"ok":true,"app":"RDAscraper","version":"64.0.0"}`)
	}))
	defer s.Close()
	startupWriteAddress(t, dir, s.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	release, existing, err := waitForInstance(ctx, dir)
	if release != nil {
		defer release()
	}
	if err != nil || release == nil || existing.Address != "" {
		t.Fatalf("stale address prevented new ownership: %+v, %v", existing, err)
	}
	if probes.Load() != 0 {
		t.Fatal("unlocked stale address was probed")
	}
}

func TestReplacementWaitsForManualExitAndPreservesSavedWork(t *testing.T) {
	dir := t.TempDir()
	unlock, owner, err := singleInstance(dir)
	if err != nil || !owner {
		t.Fatalf("initial owner: %v, %v", owner, err)
	}
	defer func() {
		if unlock != nil {
			unlock()
		}
	}()
	s := startupHealthServer(t, "64.1.1")
	startupWriteAddress(t, dir, s.URL)
	saved := []byte(`{"title":"사용자가 저장한 작업","articles":[]}`)
	projectPath := filepath.Join(dir, "last_project.json")
	if err := os.WriteFile(projectPath, saved, 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	type result struct {
		release  func()
		existing localInstance
		err      error
	}
	completed := make(chan result, 1)
	go func() {
		release, existing, err := waitForReplacement(ctx, dir, version)
		completed <- result{release, existing, err}
	}()
	select {
	case got := <-completed:
		if got.release != nil {
			got.release()
		}
		t.Fatalf("replacement returned while healthy older owner is still running: %+v, %v", got.existing, got.err)
	case <-time.After(250 * time.Millisecond):
	}
	if address, err := os.ReadFile(filepath.Join(dir, "address.txt")); err != nil || string(address) != s.URL {
		t.Fatalf("replacement changed previous connection address: %q, %v", address, err)
	}
	// The user closes the old application; only then can the new launcher own
	// its profile. A still-responsive stale address must not block that handoff.
	unlock()
	unlock = nil
	select {
	case got := <-completed:
		if got.release != nil {
			defer got.release()
		}
		if got.err != nil || got.release == nil || got.existing.Address != "" {
			t.Fatalf("replacement did not acquire released profile: %+v, %v", got.existing, got.err)
		}
	case <-ctx.Done():
		t.Fatal("replacement did not start after manual owner exit")
	}
	if data, err := os.ReadFile(projectPath); err != nil || string(data) != string(saved) {
		t.Fatalf("saved project changed during handoff: %q, %v", data, err)
	}
}

func TestReplacementTimeoutDoesNotStealHealthyOwnersLock(t *testing.T) {
	dir := t.TempDir()
	unlock, owner, err := singleInstance(dir)
	if err != nil || !owner {
		t.Fatalf("initial owner: %v, %v", owner, err)
	}
	defer func() {
		if unlock != nil {
			unlock()
		}
	}()
	s := startupHealthServer(t, "64.1.1")
	startupWriteAddress(t, dir, s.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 350*time.Millisecond)
	defer cancel()
	release, existing, err := waitForReplacement(ctx, dir, version)
	if release != nil {
		release()
		t.Fatal("replacement stole the previous owner's lock")
	}
	if err == nil || ctx.Err() == nil || existing.Address != "" {
		t.Fatalf("replacement accepted older process instead of timing out: %+v, %v", existing, err)
	}
	if address, err := os.ReadFile(filepath.Join(dir, "address.txt")); err != nil || string(address) != s.URL {
		t.Fatalf("timeout changed previous connection address: %q, %v", address, err)
	}
	duplicate, acquired, err := singleInstance(dir)
	if duplicate != nil {
		duplicate()
	}
	if err != nil || acquired {
		t.Fatalf("previous owner lost its exclusive lock: %v, %v", acquired, err)
	}
	unlock()
	unlock = nil
	recovered, acquired, err := singleInstance(dir)
	if recovered != nil {
		defer recovered()
	}
	if err != nil || !acquired || recovered == nil {
		t.Fatalf("replacement probes retained duplicate lock handles: %v, %v", acquired, err)
	}
}

func TestReplacementReusesSameVersionWinner(t *testing.T) {
	dir := t.TempDir()
	unlock, owner, err := singleInstance(dir)
	if err != nil || !owner {
		t.Fatalf("competing new owner: %v, %v", owner, err)
	}
	defer unlock()
	s := startupHealthServer(t, version)
	startupWriteAddress(t, dir, s.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	release, existing, err := waitForReplacement(ctx, dir, version)
	if release != nil {
		defer release()
		t.Fatal("replacement became a second owner")
	}
	if err != nil || existing.Address != s.URL+"/" || existing.Version != version {
		t.Fatalf("same-version winner was not reused: %+v, %v", existing, err)
	}
}
