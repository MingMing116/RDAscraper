package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math"
	"os"
	"path/filepath"
	"time"
	"unicode/utf16"
)

var errProject = errors.New("작업 파일의 항목 형식, 날짜 또는 크기를 확인하세요")

type fieldCheck func(any) bool

func stringField(max int) fieldCheck {
	return func(v any) bool { s, ok := v.(string); return ok && len(utf16.Encode([]rune(s))) <= max }
}
func numberField(min, max float64, integer, nullable bool) fieldCheck {
	return func(v any) bool {
		if nullable && v == nil {
			return true
		}
		n, ok := v.(float64)
		return ok && !math.IsInf(n, 0) && !math.IsNaN(n) && n >= min && n <= max && (!integer || math.Trunc(n) == n)
	}
}
func boolField(v any) bool { _, ok := v.(bool); return ok }
func dayField(v any) bool {
	s, ok := v.(string)
	if !ok {
		return false
	}
	if s == "" {
		return true
	}
	d, e := time.Parse("2006-01-02", s)
	return e == nil && d.Format("2006-01-02") == s
}
func requiredDay(v any) bool { return v != "" && dayField(v) }
func enumField(options ...any) fieldCheck {
	return func(v any) bool {
		for _, x := range options {
			if v == x {
				return true
			}
		}
		return false
	}
}
func listField(max int, check fieldCheck) fieldCheck {
	return func(v any) bool {
		a, ok := v.([]any)
		if !ok || len(a) > max {
			return false
		}
		for _, x := range a {
			if !check(x) {
				return false
			}
		}
		return true
	}
}
func urlField(empty bool) fieldCheck {
	return func(v any) bool {
		s, ok := v.(string)
		if !ok {
			return false
		}
		if empty && s == "" {
			return true
		}
		_, e := parsePublicURL(s)
		return e == nil
	}
}
func copyFields(in map[string]any, rules map[string]fieldCheck) (map[string]any, error) {
	out := map[string]any{}
	for key, check := range rules {
		if v, ok := in[key]; ok {
			if !check(v) {
				return nil, errProject
			}
			out[key] = v
		}
	}
	return out, nil
}
func sanitizeProject(data []byte) ([]byte, error) {
	if len(data) > maxProject {
		return nil, errProject
	}
	d := json.NewDecoder(bytes.NewReader(data))
	var p map[string]any
	if d.Decode(&p) != nil || p == nil {
		return nil, errProject
	}
	var tail any
	if d.Decode(&tail) != io.EOF {
		return nil, errProject
	}
	if p["schema"] != "rdascraper-project" || !enumField(float64(61), float64(62), float64(63), float64(64))(p["version"]) {
		return nil, errProject
	}
	results, ok := p["results"].([]any)
	if !ok || len(results) > 2000 {
		return nil, errProject
	}
	rules := map[string]fieldCheck{"schema": stringField(32), "version": numberField(61, 64, true, false), "savedAt": numberField(0, 9007199254740991, true, false), "start": requiredDay, "end": requiredDay, "demo": boolField, "reset": boolField, "queries": stringField(25000), "duration": enumField(float64(7), float64(14), float64(21), float64(28)), "mode": enumField("8", "25"), "ocrMode": enumField("auto", "always", "off"), "sources": listField(4, enumField("naver", "google", "daum", "bing"))}
	out, e := copyFields(p, rules)
	if e != nil {
		return nil, e
	}
	press, hasPress := p["press"]
	if !hasPress {
		return nil, errProject
	}
	if p["reset"] == true && press != nil {
		return nil, errProject
	}
	if sources, ok := p["sources"].([]any); ok {
		seen := map[string]bool{}
		for _, s := range sources {
			key := s.(string)
			if seen[key] {
				return nil, errProject
			}
			seen[key] = true
		}
	}
	if press == nil {
		if len(results) != 0 {
			return nil, errProject
		}
		out["press"] = nil
	} else {
		pr, ok := press.(map[string]any)
		if !ok {
			return nil, errProject
		}
		text, ok := pr["text"].(string)
		if !ok || len(utf16.Encode([]rune(text))) < 2 {
			return nil, errProject
		}
		prules := map[string]fieldCheck{"text": stringField(2000000), "title": stringField(1000), "keywords": listField(40, stringField(40)), "activeKeywords": listField(40, stringField(40)), "queries": listField(25, stringField(1000)), "warnings": listField(50, stringField(2000)), "releaseDate": dayField, "format": stringField(100), "quality": stringField(200), "filename": stringField(255), "characters": numberField(0, 2000000, true, false), "pages": numberField(1, 100, true, true), "ocrPages": numberField(0, 100, true, false), "ocrConfidence": numberField(0, 100, false, true)}
		clean, e := copyFields(pr, prules)
		if e != nil {
			return nil, e
		}
		keys := map[string]bool{}
		if a, ok := clean["keywords"].([]any); ok {
			for _, k := range a {
				keys[k.(string)] = true
			}
		}
		if a, ok := clean["activeKeywords"].([]any); ok {
			for _, k := range a {
				if !keys[k.(string)] {
					return nil, errProject
				}
			}
		}
		out["press"] = clean
	}
	if press != nil || p["reset"] != true {
		if !requiredDay(p["start"]) || !requiredDay(p["end"]) {
			return nil, errProject
		}
	}
	if start, ok := p["start"].(string); ok {
		if end, ok := p["end"].(string); ok && start > end {
			return nil, errProject
		}
	}
	arules := map[string]fieldCheck{"url": urlField(false), "title": stringField(2000), "media": stringField(400), "snippet": stringField(50000), "body": stringField(2000000), "dateSource": stringField(200), "source": stringField(200), "query": stringField(1000), "category": stringField(200), "institution": stringField(200), "fetchNote": stringField(2000), "bodySource": stringField(200), "observedTitle": stringField(2000), "originalSearchTitle": stringField(2000), "id": stringField(8192), "origin": urlField(true), "portalURL": urlField(true), "date": dayField, "searchDate": dayField, "sources": listField(10, stringField(200)), "matched": listField(40, stringField(40)), "warnings": listField(50, stringField(2000)), "mediaScore": numberField(0, 10000, false, true), "match": numberField(0, 100, false, false), "articleNo": numberField(1, 2000, true, false)}
	for _, k := range []string{"checked", "eligible", "included", "dateOK", "excluded", "manual", "userEdited", "bodyUserEdited", "bodyLimited", "linkMismatch", "dateDifference"} {
		arules[k] = boolField
	}
	cleanResults := make([]any, 0, len(results))
	for _, raw := range results {
		a, ok := raw.(map[string]any)
		if !ok || !urlField(false)(a["url"]) || !stringField(2000)(a["title"]) {
			return nil, errProject
		}
		clean, e := copyFields(a, arules)
		if e != nil {
			return nil, e
		}
		cleanResults = append(cleanResults, clean)
	}
	out["results"] = cleanResults
	return json.Marshal(out)
}

func writeAtomic(path string, data []byte) error {
	f, e := os.CreateTemp(filepath.Dir(path), ".project-*")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	if _, e = f.Write(data); e == nil {
		e = f.Sync()
	}
	closeErr := f.Close()
	if e == nil {
		e = closeErr
	}
	if e != nil {
		return e
	}
	return os.Rename(f.Name(), path)
}
func (a *app) autoSaveEnabled() bool {
	data, e := os.ReadFile(filepath.Join(a.dataDir, "preferences.json"))
	if os.IsNotExist(e) {
		return true
	}
	if e != nil {
		return false
	}
	var p struct {
		AutoSave *bool `json:"autoSave"`
	}
	if json.Unmarshal(data, &p) != nil || p.AutoSave == nil {
		return false
	}
	return *p.AutoSave
}

// Caller holds projectMu; preference is written first so a failed cleanup cannot
// allow subsequent automatic saves to recreate the user's document contents.
func (a *app) disableAutoSave() (json.RawMessage, error) {
	if e := writeAtomic(filepath.Join(a.dataDir, "preferences.json"), []byte(`{"autoSave":false}`)); e != nil {
		return nil, e
	}
	stamp := time.Now().UnixMilli()
	// Beat an older timestamp already persisted, without trusting future input
	// timestamps for project selection. Frontend treats reset:true as authoritative.
	blank, _ := json.Marshal(map[string]any{"schema": "rdascraper-project", "version": 64, "savedAt": stamp, "press": nil, "results": []any{}, "reset": true})
	if e := writeAtomic(filepath.Join(a.dataDir, "last-project.json"), blank); e != nil {
		return nil, e
	}
	a.cacheMu.Lock()
	a.cache = map[string]cacheItem{}
	a.cacheEpoch++
	a.cacheMu.Unlock()
	if a.logWriter != nil {
		if e := a.logWriter.Clear(); e != nil {
			return nil, e
		}
	}
	return json.RawMessage(blank), nil
}
