// JayDymo desktop app for Windows.
//
// Serves the embedded web app on a local port and shows it in a native window
// using the Microsoft Edge WebView2 runtime (part of Windows 10/11).
//
// Build:  see build.sh
package main

import (
	"os"
	"path/filepath"
	"syscall"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
)

func main() {
	start, err := startServer(os.Args[1:])
	if err != nil {
		fatal("Could not open a local port: " + err.Error())
	}
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		DataPath:  filepath.Join(os.Getenv("LOCALAPPDATA"), "JayDymo"),
		AutoFocus: true,
		WindowOptions: webview2.WindowOptions{
			Title: "JayDymo", Width: 1400, Height: 900, Center: true, IconId: 1,
		},
	})
	if w == nil {
		fatal("JayDymo needs the Microsoft Edge WebView2 Runtime.\n\nIt is included in Windows 10/11; if it is missing, install it from\nhttps://go.microsoft.com/fwlink/p/?LinkId=2124703")
	}
	defer w.Destroy()
	w.Navigate(start)
	w.Run()
}

var procMessageBox = syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")

func fatal(msg string) {
	t, _ := syscall.UTF16PtrFromString("JayDymo")
	m, _ := syscall.UTF16PtrFromString(msg)
	procMessageBox.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), 0x10)
	os.Exit(1)
}
