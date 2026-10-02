//go:build windows

package main

import (
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

var kernel = syscall.NewLazyDLL("kernel32.dll")
var shell = syscall.NewLazyDLL("shell32.dll")
var user = syscall.NewLazyDLL("user32.dll")

func wide(s string) *uint16 { p, _ := syscall.UTF16PtrFromString(s); return p }
func singleInstance(dir string) (func(), bool, error) {
	name := fmt.Sprintf("Local\\RDAscraper63_%x", sha256.Sum256([]byte(dir)))
	h, _, err := kernel.NewProc("CreateMutexW").Call(0, 0, uintptr(unsafe.Pointer(wide(name))))
	if h == 0 {
		return nil, false, err
	}
	if err == syscall.ERROR_ALREADY_EXISTS {
		// A secondary launcher must not keep the named object alive after the
		// original process exits, including while an error dialog is visible.
		kernel.NewProc("CloseHandle").Call(h)
		return nil, false, nil
	}
	return func() { kernel.NewProc("CloseHandle").Call(h) }, true, nil
}
func openBrowser(address string) error {
	candidates := []string{filepath.Join(os.Getenv("ProgramFiles(x86)"), "Microsoft", "Edge", "Application", "msedge.exe"), filepath.Join(os.Getenv("ProgramFiles"), "Microsoft", "Edge", "Application", "msedge.exe"), filepath.Join(os.Getenv("ProgramFiles"), "Google", "Chrome", "Application", "chrome.exe")}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			cmd := exec.Command(p, "--app="+address, "--new-window")
			if err = cmd.Start(); err == nil {
				go cmd.Wait()
				return nil
			}
		}
	}
	r, _, err := shell.NewProc("ShellExecuteW").Call(0, uintptr(unsafe.Pointer(wide("open"))), uintptr(unsafe.Pointer(wide(address))), 0, 0, 1)
	if r <= 32 {
		return fmt.Errorf("브라우저 열기 실패: %v", err)
	}
	return nil
}
func showError(message string) {
	user.NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(wide(message))), uintptr(unsafe.Pointer(wide("RDAscraper 실행 확인"))), 0x10)
}
func showInfo(message string) {
	user.NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(wide(message))), uintptr(unsafe.Pointer(wide("RDAscraper"))), 0x40)
}

func confirmUpgrade() bool {
	message := "이전 프로그램 화면을 열었습니다. 새 실행파일의 변경 사항을 적용하려면 다음 순서로 진행하세요.\n\n1. 열린 화면에서 '작업 저장'을 누르세요.\n2. 프로그램 안의 '종료'를 누르세요.\n3. 이 안내창의 '확인'을 누르세요. 새 화면이 자동으로 열립니다.\n\n브라우저 창만 닫지 말고 프로그램 안의 '종료'를 사용하세요.\n취소하면 기존 프로그램과 작업을 그대로 유지합니다."
	// OK/Cancel belongs to this launcher, not the browser. Closing the dialog
	// returns Cancel; neither path sends shutdown commands to the old server.
	result, _, _ := user.NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(wide(message))), uintptr(unsafe.Pointer(wide("RDAscraper 새 화면 열기"))), 0x41)
	return result == 1
}
