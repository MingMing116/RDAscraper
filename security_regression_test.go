package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"golang.org/x/net/dns/dnsmessage"
	"io"
	"log"
	"math/big"
	"net"
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

func validSecurityProject() map[string]any {
	return map[string]any{"schema": "rdascraper-project", "version": 64, "savedAt": 1, "press": map[string]any{"text": "공개 테스트 문서", "title": "테스트", "keywords": []string{"테스트"}}, "results": []any{map[string]any{"title": "기사", "url": "https://93.184.216.34/news", "mediaScore": 1.0, "match": 50.0, "articleNo": 1}}, "start": "2026-01-01", "end": "2026-01-15"}
}
func projectString(p map[string]any) string { b, _ := json.Marshal(p); return string(b) }
func TestProjectRejectsDangerousFieldsAndDiskRestore(t *testing.T) {
	for _, field := range []string{"mediaScore", "match", "articleNo", "checked", "eligible", "warnings", "title", "url"} {
		t.Run(field, func(t *testing.T) {
			a := testApp(t)
			p := validSecurityProject()
			article := p["results"].([]any)[0].(map[string]any)
			article[field] = map[string]any{"payload": "<img src=x onerror=alert(1)>"}
			b := projectString(p)
			if r := call(a, "POST", "/api/project", b, a.token); r.Code != 400 {
				t.Fatalf("POST accepted %s %d", field, r.Code)
			}
			os.WriteFile(filepath.Join(a.dataDir, "last-project.json"), []byte(b), 0600)
			if r := call(a, "GET", "/api/project", "", a.token); r.Code != 500 {
				t.Fatalf("disk restore accepted %s %d", field, r.Code)
			}
		})
	}
	for _, version := range []int{61, 62, 63, 64} {
		a := testApp(t)
		p := validSecurityProject()
		p["version"] = version
		p["unexpectedSecret"] = "must-not-save"
		if r := call(a, "POST", "/api/project", projectString(p), a.token); r.Code != 200 {
			t.Fatalf("version%d: %s", version, r.Body.String())
		}
		b, _ := os.ReadFile(filepath.Join(a.dataDir, "last-project.json"))
		if bytes.Contains(b, []byte("unexpectedSecret")) {
			t.Fatal("unknown field retained")
		}
	}
	for _, value := range []any{-1, 101, "50", nil, []any{50}} {
		p := validSecurityProject()
		p["results"].([]any)[0].(map[string]any)["match"] = value
		if _, e := sanitizeProject([]byte(projectString(p))); e == nil {
			t.Fatalf("invalid match accepted %v", value)
		}
	}
	p := validSecurityProject()
	p["reset"] = true
	if _, e := sanitizeProject([]byte(projectString(p))); e == nil {
		t.Fatal("reset with document accepted")
	}
}
func TestPrivacyPreferenceDeletionAndRaceBarrier(t *testing.T) {
	a := testApp(t)
	a.logWriter, _ = openRotatingLog(filepath.Join(a.dataDir, "RDAscraper.log"))
	defer a.logWriter.Close()
	a.logWriter.Write([]byte("old log"))
	a.cache["old"] = cacheItem{}
	body := projectString(validSecurityProject())
	if call(a, "POST", "/api/project", body, a.token).Code != 200 {
		t.Fatal("setup")
	}
	if call(a, "DELETE", "/api/project", "", "bad").Code != 403 {
		t.Fatal("delete auth")
	}
	if call(a, "POST", "/api/preferences", `{"autoSave":false}`, "bad").Code != 403 {
		t.Fatal("preference auth")
	}
	if r := call(a, "DELETE", "/api/project", "", a.token); r.Code != 200 || !strings.Contains(r.Body.String(), `"reset":true`) {
		t.Fatal(r.Body.String())
	}
	if call(a, "POST", "/api/project", body, a.token).Code != 409 {
		t.Fatal("stale browser resaved")
	}
	b := testApp(t)
	b.dataDir = a.dataDir
	if !strings.Contains(call(b, "GET", "/api/config", "", "").Body.String(), `"autoSave":false`) {
		t.Fatal("preference not durable")
	}
	saved, _ := os.ReadFile(filepath.Join(a.dataDir, "last-project.json"))
	if bytes.Contains(saved, []byte("공개 테스트")) {
		t.Fatal("old document retained")
	}
	log, _ := os.ReadFile(a.logWriter.path)
	if len(log) != 0 || len(a.cache) != 0 {
		t.Fatal("log/cache retained")
	}
	if call(a, "POST", "/api/preferences", `{"autoSave":true}`, a.token).Code != 200 || call(a, "POST", "/api/project", body, a.token).Code != 200 {
		t.Fatal("reenable")
	}
	if call(a, "POST", "/api/preferences", `{"autoSave":false}`, a.token).Code != 200 || call(a, "POST", "/api/project", body, a.token).Code != 409 {
		t.Fatal("disable toggle")
	}
}
func TestSecurityHeadersAndBoundedLog(t *testing.T) {
	r := call(testApp(t), "GET", "/", "", "")
	csp := r.Header().Get("Content-Security-Policy")
	for _, part := range []string{"script-src 'self' 'wasm-unsafe-eval'", "script-src-attr 'none'", "frame-ancestors 'none'", "object-src 'none'"} {
		if !strings.Contains(csp, part) {
			t.Fatal("CSP", csp)
		}
	}
	if r.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatal("frame header")
	}
	path := filepath.Join(t.TempDir(), "RDAscraper.log")
	w, e := openRotatingLog(path)
	if e != nil {
		t.Fatal(e)
	}
	defer w.Close()
	for i := 0; i < 5; i++ {
		w.Write(bytes.Repeat([]byte{'x'}, localLogLimit/2))
	}
	for _, p := range []string{path, path + ".1"} {
		s, e := os.Stat(p)
		if e != nil || s.Size() > localLogLimit {
			t.Fatal("unbounded log", e)
		}
	}
	if e := w.Clear(); e != nil {
		t.Fatal(e)
	}
	if _, e := os.Stat(path + ".1"); !os.IsNotExist(e) {
		t.Fatal("backup retained")
	}
}
func TestValidatedLiteralDialAndMixedDNS(t *testing.T) {
	count := 0
	dials := 0
	d := publicDialer{lookup: func(context.Context, string, string) ([]net.IP, error) {
		count++
		return []net.IP{net.ParseIP("93.184.216.34")}, nil
	}, dial: func(_ context.Context, _ string, address string) (net.Conn, error) {
		dials++
		if address != "93.184.216.34:443" {
			t.Fatalf("hostname reached dial %s", address)
		}
		a, b := net.Pipe()
		b.Close()
		return a, nil
	}}
	c, e := d.DialContext(context.Background(), "tcp", "news.test:443")
	if e != nil || count != 1 || dials != 1 {
		t.Fatal("pinning", e, count, dials)
	}
	c.Close()
	d.lookup = func(context.Context, string, string) ([]net.IP, error) {
		return []net.IP{net.ParseIP("93.184.216.34"), net.ParseIP("::ffff:127.0.0.1")}, nil
	}
	if _, e = d.DialContext(context.Background(), "tcp", "news.test:443"); e == nil || dials != 1 {
		t.Fatal("mixed DNS accepted")
	}
	for _, ip := range []string{"::1", "::ffff:10.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::", "192.0.0.1", "203.0.113.1", "240.0.0.1"} {
		if publicIP(net.ParseIP(ip)) {
			t.Fatal("special IP accepted", ip)
		}
	}
}
func TestDNSRebindingBlockedBeforeInternalConnection(t *testing.T) {
	listener, e := net.Listen("tcp4", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	var hits atomic.Int32
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1); fmt.Fprint(w, "LOCAL-MARKER") })}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close() })
	dns, e := net.ListenUDP("udp4", &net.UDPAddr{IP: net.ParseIP("127.0.0.1")})
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { dns.Close() })
	var lookups atomic.Int32
	go func() {
		buf := make([]byte, 4096)
		for {
			n, peer, e := dns.ReadFromUDP(buf)
			if e != nil {
				return
			}
			var parser dnsmessage.Parser
			header, e := parser.Start(buf[:n])
			if e != nil {
				continue
			}
			q, e := parser.Question()
			if e != nil {
				continue
			}
			b := dnsmessage.NewBuilder(nil, dnsmessage.Header{ID: header.ID, Response: true, Authoritative: true, RecursionAvailable: true})
			b.StartQuestions()
			b.Question(q)
			b.StartAnswers()
			if q.Type == dnsmessage.TypeA {
				ip := [4]byte{93, 184, 216, 34}
				if lookups.Add(1) > 1 {
					ip = [4]byte{127, 0, 0, 1}
				}
				b.AResource(dnsmessage.ResourceHeader{Name: q.Name, Type: dnsmessage.TypeA, Class: dnsmessage.ClassINET, TTL: 0}, dnsmessage.AResource{A: ip})
			}
			reply, e := b.Finish()
			if e == nil {
				dns.WriteToUDP(reply, peer)
			}
		}
	}()
	old := net.DefaultResolver
	net.DefaultResolver = &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{Timeout: time.Second}).DialContext(ctx, "udp4", dns.LocalAddr().String())
	}}
	t.Cleanup(func() { net.DefaultResolver = old })
	a := testApp(t)
	tr := a.client.Transport.(*publicTransport)
	tr.proxy = func(*http.Request) (*url.URL, error) { return nil, nil }
	var dials atomic.Int32
	d := defaultPublicDialer()
	d.dial = func(context.Context, string, string) (net.Conn, error) {
		dials.Add(1)
		return nil, fmt.Errorf("must not dial")
	}
	tr.direct.DialContext = d.DialContext
	got := a.fetch(context.Background(), "http://rda-rebind.invalid/probe")
	if got.OK || lookups.Load() < 2 || hits.Load() != 0 || dials.Load() != 0 {
		t.Fatalf("rebind escaped: %+v lookups%d hits%d dials%d", got, lookups.Load(), hits.Load(), dials.Load())
	}
	t.Logf("blocked rebinding with %d DNS A lookups, %d internal hits, %d TCP attempts", lookups.Load(), hits.Load(), dials.Load())
}

func proxyCertificate(t *testing.T) (tls.Certificate, *x509.CertPool) {
	t.Helper()
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	template := x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "fixture"}, DNSNames: []string{"news.test"}, IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, e := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if e != nil {
		t.Fatal(e)
	}
	encodedKey, _ := x509.MarshalECPrivateKey(key)
	cert, e := tls.X509KeyPair(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: encodedKey}))
	if e != nil {
		t.Fatal(e)
	}
	roots := x509.NewCertPool()
	parsed, _ := x509.ParseCertificate(der)
	roots.AddCert(parsed)
	return cert, roots
}
func TestApprovedProxyUsesPinnedDestinationAndVerifiedTLS(t *testing.T) {
	cert, roots := proxyCertificate(t)
	for _, proxyTLS := range []bool{false, true} {
		for _, destinationTLS := range []bool{false, true} {
			name := fmt.Sprintf("proxyTLS%v_destinationTLS%v", proxyTLS, destinationTLS)
			t.Run(name, func(t *testing.T) {
				var requests atomic.Int32
				observed := make(chan string, 2)
				handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if destinationTLS {
						if r.Method != "CONNECT" || r.Host != "93.184.216.34:443" {
							observed <- "wrong CONNECT " + r.Method + " " + r.Host
							w.WriteHeader(400)
							return
						}
						conn, _, e := w.(http.Hijacker).Hijack()
						if e != nil {
							return
						}
						defer conn.Close()
						fmt.Fprint(conn, "HTTP/1.1 200 Connection Established\r\n\r\n")
						secure := tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12})
						defer secure.Close()
						if e := secure.Handshake(); e != nil {
							return
						}
						inner, e := http.ReadRequest(bufio.NewReader(secure))
						if e != nil {
							return
						}
						observed <- inner.Host
						requests.Add(1)
						fmt.Fprint(secure, "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
					} else {
						if r.URL.Host != "93.184.216.34:80" {
							observed <- "wrong absolute target " + r.URL.String()
							w.WriteHeader(400)
							return
						}
						observed <- r.Host
						requests.Add(1)
						fmt.Fprint(w, "ok")
					}
				})
				proxy := httptest.NewUnstartedServer(handler)
				proxy.Config.ErrorLog = log.New(io.Discard, "", 0)
				if proxyTLS {
					proxy.TLS = &tls.Config{Certificates: []tls.Certificate{cert}}
					proxy.StartTLS()
				} else {
					proxy.Start()
				}
				defer proxy.Close()
				proxyURL, _ := url.Parse(proxy.URL)
				actualProxyAddress := proxyURL.Host
				if proxyTLS {
					proxyURL.Host = "127.0.0.1"
				} // Exercise HTTPS default port after internal scheme change.
				client := remoteClient()
				tr := client.Transport.(*publicTransport)
				tr.proxy = func(r *http.Request) (*url.URL, error) {
					if r.URL.Host != "news.test" {
						t.Fatal("proxy selected using rewritten host")
					}
					return proxyURL, nil
				}
				tr.destination.lookup = func(context.Context, string, string) ([]net.IP, error) {
					return []net.IP{net.ParseIP("93.184.216.34")}, nil
				}
				tr.tlsConfig = &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}
				if proxyTLS {
					tr.dialProxy = func(ctx context.Context, network, address string) (net.Conn, error) {
						if address != "127.0.0.1:443" {
							return nil, fmt.Errorf("wrong default HTTPS proxy port")
						}
						return (&net.Dialer{}).DialContext(ctx, network, actualProxyAddress)
					}
				}
				scheme := "http"
				if destinationTLS {
					scheme = "https"
				}
				response, e := client.Get(scheme + "://news.test/news?test=1")
				if e != nil {
					t.Fatal(e)
				}
				b, _ := io.ReadAll(response.Body)
				response.Body.Close()
				if string(b) != "ok" || requests.Load() != 1 {
					t.Fatal("proxy failed", string(b))
				}
				expectedHost := "news.test"
				if !destinationTLS {
					expectedHost = "93.184.216.34:80"
				} // Go server parses absolute URI authority into Request.Host.
				if host := <-observed; host != expectedHost {
					t.Fatal("original Host lost", host)
				}
				if destinationTLS {
					tr.tlsConfig = &tls.Config{RootCAs: x509.NewCertPool(), MinVersion: tls.VersionTLS12}
					if _, e := client.Get(scheme + "://news.test/news"); e == nil {
						t.Fatal("untrusted certificate accepted")
					}
				}
			})
		}
	}
}
func TestPrivateRedirectAndProxyFailureNeverDialDirect(t *testing.T) {
	client := remoteClient()
	req, _ := http.NewRequest("GET", "http://127.0.0.1/news", nil)
	if e := client.CheckRedirect(req, []*http.Request{req}); e == nil {
		t.Fatal("private redirect accepted")
	}
	tr := client.Transport.(*publicTransport)
	tr.proxy = func(*http.Request) (*url.URL, error) { return url.Parse("http://proxy.test:8080") }
	tr.destination.lookup = func(context.Context, string, string) ([]net.IP, error) {
		return []net.IP{net.ParseIP("93.184.216.34")}, nil
	}
	tr.dialProxy = func(context.Context, string, string) (net.Conn, error) {
		return nil, fmt.Errorf("proxy down secret-query")
	}
	tr.direct.DialContext = func(context.Context, string, string) (net.Conn, error) { t.Fatal("proxy bypassed"); return nil, nil }
	_, e := client.Get("https://news.test/search?q=secret")
	if e == nil {
		t.Fatal("proxy failure hidden")
	}
	if strings.Contains(safeConnectionError(e), "secret") {
		t.Fatal("query leaked")
	}
}
