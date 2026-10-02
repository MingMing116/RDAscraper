package main

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

var (
	errURLPolicy      = errors.New("공개 http/https 기사 주소만 사용할 수 있습니다")
	errPrivateAddress = errors.New("내부망 또는 특수 목적 주소는 기사 수집에 사용할 수 없습니다")
	errDNS            = errors.New("사이트 주소를 확인하지 못했습니다")
	errProxyPolicy    = errors.New("설정된 프록시에서 안전한 기사 수집 연결을 완료하지 못했습니다. http 또는 https 프록시와 공개 IP 대상 연결 지원이 필요합니다")
)

// Reject non-public and special-use networks, including mapped IPv4 and
// translation/tunnelling ranges that could otherwise reach private addresses.
var blockedIPv4 = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"), netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("169.254.0.0/16"), netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.168.0.0/16"), netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"), netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("224.0.0.0/4"), netip.MustParsePrefix("240.0.0.0/4"),
}

func publicIP(ip net.IP) bool {
	a, ok := netip.AddrFromSlice(ip)
	if !ok {
		return false
	}
	a = a.Unmap()
	if !a.IsGlobalUnicast() || a.IsPrivate() || a.IsLoopback() || a.IsLinkLocalUnicast() || a.IsUnspecified() {
		return false
	}
	if a.Is4() {
		for _, p := range blockedIPv4 {
			if p.Contains(a) {
				return false
			}
		}
		return true
	}
	return netip.MustParsePrefix("2000::/3").Contains(a) &&
		!netip.MustParsePrefix("2001::/23").Contains(a) &&
		!netip.MustParsePrefix("2001:db8::/32").Contains(a) &&
		!netip.MustParsePrefix("2002::/16").Contains(a) &&
		!netip.MustParsePrefix("3fff::/20").Contains(a)
}

func parsePublicURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || len(raw) > 8192 || u.Hostname() == "" || u.User != nil ||
		(u.Scheme != "http" && u.Scheme != "https") ||
		(u.Port() != "" && u.Port() != "80" && u.Port() != "443") || strings.Contains(u.Hostname(), "%") {
		return nil, errURLPolicy
	}
	if ip := net.ParseIP(u.Hostname()); ip != nil && !publicIP(ip) {
		return nil, errPrivateAddress
	}
	return u, nil
}

type publicDialer struct {
	lookup func(context.Context, string, string) ([]net.IP, error)
	dial   func(context.Context, string, string) (net.Conn, error)
}

func (d publicDialer) resolve(ctx context.Context, host string) ([]net.IP, error) {
	var ips []net.IP
	if ip := net.ParseIP(host); ip != nil {
		ips = []net.IP{ip}
	} else {
		var err error
		ips, err = d.lookup(ctx, "ip", host)
		if err != nil || len(ips) == 0 {
			return nil, errDNS
		}
	}
	for _, ip := range ips {
		if !publicIP(ip) {
			return nil, errPrivateAddress
		}
	}
	return ips, nil
}

func (d publicDialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil || (port != "80" && port != "443") {
		return nil, errURLPolicy
	}
	ips, err := d.resolve(ctx, host)
	if err != nil {
		return nil, err
	}
	for _, ip := range ips {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		// The dialer receives only a validated literal IP. No hostname lookup
		// occurs between this validation and the TCP connection.
		conn, err := d.dial(ctx, network, net.JoinHostPort(ip.String(), port))
		if err == nil {
			return conn, nil
		}
	}
	return nil, errors.New("기사 사이트에 연결하지 못했습니다")
}

func defaultPublicDialer() publicDialer {
	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	return publicDialer{lookup: func(ctx context.Context, network, host string) ([]net.IP, error) {
		return net.DefaultResolver.LookupIP(ctx, network, host)
	}, dial: dialer.DialContext}
}

func validateURL(ctx context.Context, raw string) (*url.URL, error) {
	u, err := parsePublicURL(raw)
	if err != nil {
		return nil, err
	}
	_, err = defaultPublicDialer().resolve(ctx, u.Hostname())
	return u, err
}

// Every proxied request targets a validated literal IP. The original Host and
// destination TLS identity are retained. Proxy selection uses the ORIGINAL URL
// so NO_PROXY has its normal hostname semantics; a proxy failure never retries
// directly. Proxy credentials stay confined to the standard transport.
type publicTransport struct {
	direct      *http.Transport
	destination publicDialer
	proxy       func(*http.Request) (*url.URL, error)
	dialProxy   func(context.Context, string, string) (net.Conn, error)
	tlsConfig   *tls.Config
}

func (t *publicTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	u, err := parsePublicURL(req.URL.String())
	if err != nil {
		return nil, err
	}
	proxy, err := t.proxy(req)
	if err != nil {
		return nil, errProxyPolicy
	}
	if proxy == nil {
		return t.direct.RoundTrip(req)
	}
	if (proxy.Scheme != "http" && proxy.Scheme != "https") || proxy.Hostname() == "" {
		return nil, errProxyPolicy
	}
	ips, err := t.destination.resolve(req.Context(), u.Hostname())
	if err != nil {
		return nil, err
	}
	port := u.Port()
	if port == "" {
		if u.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	for _, ip := range ips {
		if req.Context().Err() != nil {
			return nil, req.Context().Err()
		}
		clone := req.Clone(req.Context())
		copyURL := *u
		copyURL.Host = net.JoinHostPort(ip.String(), port)
		// Request.WriteProxy normally builds the absolute URI from Request.Host.
		// Opaque keeps the validated authority in the request target while the
		// Host header retains the original virtual host.
		if u.Scheme == "http" {
			path := u.EscapedPath()
			if path == "" {
				path = "/"
			}
			copyURL.Opaque = "//" + copyURL.Host + path
		}
		clone.URL = &copyURL
		clone.Host = u.Host
		tr := t.direct.Clone()
		tr.DisableKeepAlives = true
		tr.DialTLSContext = nil
		tr.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12}
		if t.tlsConfig != nil {
			tr.TLSClientConfig = t.tlsConfig.Clone()
		}
		tr.TLSClientConfig.ServerName = u.Hostname()
		proxyCopy := *proxy
		// HTTPS proxies have a separate TLS session/identity from the destination.
		// Wrap that trusted first hop ourselves and let Transport establish CONNECT
		// and destination TLS over it with the destination's original server name.
		if proxyCopy.Scheme == "https" {
			proxyCopy.Scheme = "http"
			if proxyCopy.Port() == "" {
				proxyCopy.Host = net.JoinHostPort(proxy.Hostname(), "443")
			}
		}
		tr.Proxy = http.ProxyURL(&proxyCopy)
		proxyPort := proxy.Port()
		if proxyPort == "" {
			if proxy.Scheme == "https" {
				proxyPort = "443"
			} else {
				proxyPort = "80"
			}
		}
		proxyAddress := net.JoinHostPort(proxy.Hostname(), proxyPort)
		tr.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
			if address != proxyAddress {
				return nil, errProxyPolicy
			}
			conn, err := t.dialProxy(ctx, network, proxyAddress)
			if err != nil {
				return nil, errProxyPolicy
			}
			if proxy.Scheme == "https" {
				cfg := &tls.Config{MinVersion: tls.VersionTLS12}
				if t.tlsConfig != nil {
					cfg = t.tlsConfig.Clone()
				}
				cfg.ServerName = proxy.Hostname()
				cfg.NextProtos = nil
				secure := tls.Client(conn, cfg)
				if err := secure.HandshakeContext(ctx); err != nil {
					conn.Close()
					return nil, errProxyPolicy
				}
				return secure, nil
			}
			return conn, nil
		}
		response, err := tr.RoundTrip(clone)
		if err == nil {
			response.Request = req
			return response, nil
		}
		tr.CloseIdleConnections()
	}
	return nil, errProxyPolicy
}
func (t *publicTransport) CloseIdleConnections() { t.direct.CloseIdleConnections() }
func remoteClient() *http.Client {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.Proxy = nil
	destination := defaultPublicDialer()
	tr.DialContext = destination.DialContext
	tr.DialTLSContext = nil
	tr.MaxIdleConns = 16
	tr.MaxIdleConnsPerHost = 3
	tr.MaxConnsPerHost = 4
	tr.ResponseHeaderTimeout = 12 * time.Second
	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	transport := &publicTransport{direct: tr, destination: destination, proxy: http.ProxyFromEnvironment, dialProxy: dialer.DialContext}
	return &http.Client{Transport: transport, Timeout: 18 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 6 {
			return errors.New("주소 이동 횟수를 초과했습니다")
		}
		_, err := validateURL(req.Context(), req.URL.String())
		return err
	}}
}

func safeConnectionError(err error) string {
	for _, known := range []error{errProxyPolicy, errPrivateAddress, errURLPolicy, errDNS} {
		if errors.Is(err, known) {
			return known.Error()
		}
	}
	if errors.Is(err, context.Canceled) {
		return "요청이 중단되었습니다"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "기사 사이트 응답 시간이 초과되었습니다"
	}
	return "기사 사이트에 연결하지 못했습니다. 인터넷 연결과 사이트 응답을 확인하세요"
}
