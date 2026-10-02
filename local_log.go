package main

import (
	"os"
	"sync"
)

const localLogLimit = 1 << 20

// At most one 1 MiB current log and one 1 MiB backup; no document text or URL
// query values are written by the application logger.
type rotatingLog struct {
	mu   sync.Mutex
	path string
	file *os.File
	size int64
}

func openRotatingLog(path string) (*rotatingLog, error) {
	r := &rotatingLog{path: path}
	f, e := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if e != nil {
		return nil, e
	}
	r.file = f
	if st, e := f.Stat(); e == nil {
		r.size = st.Size()
	}
	if r.size >= localLogLimit {
		if e := r.rotate(); e != nil {
			f.Close()
			return nil, e
		}
	}
	return r, nil
}
func (r *rotatingLog) rotate() error {
	if e := r.file.Close(); e != nil {
		return e
	}
	_ = os.Remove(r.path + ".1")
	// Oversized legacy logs are removed, so upgrades do not retain unlimited logs.
	if r.size > localLogLimit {
		_ = os.Remove(r.path)
	} else if e := os.Rename(r.path, r.path+".1"); e != nil && !os.IsNotExist(e) {
		return e
	}
	f, e := os.OpenFile(r.path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if e != nil {
		return e
	}
	r.file = f
	r.size = 0
	return nil
}
func (r *rotatingLog) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	original := len(p)
	if len(p) > localLogLimit {
		p = p[len(p)-localLogLimit:]
	}
	if r.size+int64(len(p)) > localLogLimit {
		if e := r.rotate(); e != nil {
			return 0, e
		}
	}
	n, e := r.file.Write(p)
	r.size += int64(n)
	if e == nil {
		return original, nil
	}
	return n, e
}
func (r *rotatingLog) Close() error { r.mu.Lock(); defer r.mu.Unlock(); return r.file.Close() }
func (r *rotatingLog) Clear() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if e := r.file.Truncate(0); e != nil {
		return e
	}
	if _, e := r.file.Seek(0, 0); e != nil {
		return e
	}
	r.size = 0
	if e := os.Remove(r.path + ".1"); e != nil && !os.IsNotExist(e) {
		return e
	}
	return r.file.Sync()
}
