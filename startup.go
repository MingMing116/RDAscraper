package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type localInstance struct {
	Address string
	Version string
}

// The health endpoint is stable across releases. A healthy older process owns
// the same data directory and must be reopened, not mistaken for a hung process.
func probeLocalInstance(address string) (localInstance, error) {
	return probeLocalInstanceContext(context.Background(), address)
}

func probeLocalInstanceContext(ctx context.Context, address string) (localInstance, error) {
	u, err := url.Parse(address)
	if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" ||
		u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" ||
		(u.Path != "" && u.Path != "/") || u.RawPath != "" || u.Opaque != "" {
		return localInstance{}, errors.New("invalid local application address")
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil || port < 1 || port > 65535 {
		return localInstance{}, errors.New("invalid local application port")
	}
	address = "http://127.0.0.1:" + strconv.Itoa(port) + "/"
	ctx, cancel := context.WithTimeout(ctx, 600*time.Millisecond)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, address+"api/health", nil)
	if err != nil {
		return localInstance{}, err
	}
	transport := &http.Transport{Proxy: nil, DisableKeepAlives: true}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	response, err := client.Do(req)
	if err != nil {
		return localInstance{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return localInstance{}, fmt.Errorf("local health HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 4097))
	if err != nil || len(data) > 4096 {
		return localInstance{}, errors.New("invalid local health response size")
	}
	var health struct {
		OK      bool   `json:"ok"`
		App     string `json:"app"`
		Version string `json:"version"`
	}
	if json.Unmarshal(data, &health) != nil || !health.OK || health.App != "RDAscraper" ||
		health.Version == "" || len(health.Version) > 64 {
		return localInstance{}, errors.New("invalid local application health")
	}
	return localInstance{Address: address, Version: health.Version}, nil
}

func localReady(address string) bool {
	_, err := probeLocalInstance(address)
	return err == nil
}

// Only the OS lock decides whether a new server may start. Missing, stale, or
// unhealthy address files never authorize a second writer to the same profile.
// Reacquiring on each retry allows recovery when the owner exits while we wait.
func waitForInstance(ctx context.Context, dir string) (func(), localInstance, error) {
	return waitForProfileInstance(ctx, dir, "")
}

// Replacement is explicitly requested after the user saves and closes the old
// application. Never shut down that process or take its lock. If a competing
// launcher starts this release first, reuse its healthy server instead.
func waitForReplacement(ctx context.Context, dir, desiredVersion string) (func(), localInstance, error) {
	if desiredVersion == "" {
		return nil, localInstance{}, errors.New("replacement version is required")
	}
	return waitForProfileInstance(ctx, dir, desiredVersion)
}

func waitForProfileInstance(ctx context.Context, dir, desiredVersion string) (func(), localInstance, error) {
	for {
		if err := ctx.Err(); err != nil {
			return nil, localInstance{}, err
		}
		release, first, err := singleInstance(dir)
		if err != nil {
			return nil, localInstance{}, err
		}
		if first {
			return release, localInstance{}, nil
		}
		if release != nil {
			release()
		}
		if f, err := os.Open(filepath.Join(dir, "address.txt")); err == nil {
			data, readErr := io.ReadAll(io.LimitReader(f, 4097))
			_ = f.Close()
			if readErr == nil && len(data) <= 4096 {
				if existing, err := probeLocalInstanceContext(ctx, strings.TrimSpace(string(data))); err == nil &&
					(desiredVersion == "" || existing.Version == desiredVersion) {
					return nil, existing, nil
				}
			}
		}
		timer := time.NewTimer(150 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, localInstance{}, ctx.Err()
		case <-timer.C:
		}
	}
}
