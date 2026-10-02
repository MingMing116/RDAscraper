//go:build linux

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

func singleInstance(dir string) (func(), bool, error) {
	f, e := os.OpenFile(filepath.Join(dir, "instance.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return nil, false, e
	}
	e = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
	if e == syscall.EWOULDBLOCK {
		f.Close()
		return nil, false, nil
	}
	if e != nil {
		f.Close()
		return nil, false, e
	}
	return func() { syscall.Flock(int(f.Fd()), syscall.LOCK_UN); f.Close() }, true, nil
}
func openBrowser(address string) error { return exec.Command("xdg-open", address).Start() }
func showError(message string)         { fmt.Fprintln(os.Stderr, message) }
func showInfo(message string)          { fmt.Fprintln(os.Stdout, message) }

func confirmUpgrade() bool {
	// Do not block a launcher or automated run on terminal input.
	showInfo("이전 프로그램 화면을 열었습니다. 새 화면을 적용하려면 열린 화면에서 '작업 저장'과 프로그램 안의 '종료'를 누른 뒤 새 실행파일을 다시 실행하세요. 기존 작업은 변경하지 않았습니다.")
	return false
}
