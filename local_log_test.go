package main

import (
	"os"
	"path/filepath"
	"testing"
)

// The first log handle must support clearing before any rotation occurs. On
// Windows, opening that handle with O_APPEND prevents truncation.
func TestLocalLogClearBeforeRotationAndContinue(t *testing.T) {
	path := filepath.Join(t.TempDir(), "RDAscraper.log")
	if err := os.WriteFile(path, []byte("previous session\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path+".1", []byte("previous backup\n"), 0600); err != nil {
		t.Fatal(err)
	}
	w, err := openRotatingLog(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if w != nil {
			w.Close()
		}
	})
	if _, err := w.Write([]byte("current session\n")); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != "previous session\ncurrent session\n" {
		t.Fatalf("existing log was not preserved: %q, %v", data, err)
	}
	if err := w.Clear(); err != nil {
		t.Fatalf("clear before rotation: %v", err)
	}
	data, err = os.ReadFile(path)
	if err != nil || len(data) != 0 {
		t.Fatalf("cleared log retained data: %q, %v", data, err)
	}
	if _, err := os.Stat(path + ".1"); !os.IsNotExist(err) {
		t.Fatalf("backup retained after clear: %v", err)
	}
	if _, err := w.Write([]byte("after clear\n")); err != nil {
		t.Fatal(err)
	}
	data, err = os.ReadFile(path)
	if err != nil || string(data) != "after clear\n" {
		t.Fatalf("write after clear: %q, %v", data, err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	w, err = openRotatingLog(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write([]byte("next session\n")); err != nil {
		t.Fatal(err)
	}
	data, err = os.ReadFile(path)
	if err != nil || string(data) != "after clear\nnext session\n" {
		t.Fatalf("append after reopen: %q, %v", data, err)
	}
}
