package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

//go:embed index.html css js
var assets embed.FS

// Labels may only be read or written through the local API if they are DYMO files.
func labelPath(p string) (string, bool) {
	ext := strings.ToLower(filepath.Ext(p))
	if p == "" || (ext != ".label" && ext != ".dymo") {
		return "", false
	}
	abs, err := filepath.Abs(p)
	return abs, err == nil
}

// startServer serves the embedded app on 127.0.0.1 and returns the start URL.
// args[0], if given, is a .label/.dymo file to open.
func startServer(args []string) (string, error) {
	// A fixed port keeps the browser storage (brand settings, last label) stable between runs.
	var ln net.Listener
	var err error
	for port := 41990; port < 42010; port++ {
		if ln, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port)); err == nil {
			break
		}
	}
	if ln == nil {
		return "", err
	}
	token := randomToken()
	go http.Serve(ln, handler(token))
	q := url.Values{"desktop": {token}}
	if len(args) > 0 {
		if p, ok := labelPath(args[0]); ok {
			q.Set("open", p)
		}
	}
	return fmt.Sprintf("http://%s/index.html?%s", ln.Addr(), q.Encode()), nil
}

func handler(token string) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.FS(assets)))
	// Read/write a .label/.dymo file on disk (used for "open with" and saving back).
	mux.HandleFunc("/api/file", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-JayDymo") != token {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		p, ok := labelPath(r.URL.Query().Get("path"))
		if !ok {
			http.Error(w, "only .label and .dymo files", http.StatusBadRequest)
			return
		}
		switch r.Method {
		case http.MethodGet:
			b, err := os.ReadFile(p)
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Type", "application/xml; charset=utf-8")
			w.Write(b)
		case http.MethodPost:
			b, err := io.ReadAll(io.LimitReader(r.Body, 64<<20))
			if err == nil {
				err = os.WriteFile(p, b, 0o644)
			}
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})
	return mux
}

func randomToken() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}
