package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image/png"
	"io"
	"io/fs"
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
	return fmt.Sprintf("http://%s/%s/index.html?%s", ln.Addr(), buildID, q.Encode()), nil
}

func handler(token string) http.Handler {
	mux := http.NewServeMux()
	// The app is served under a path unique to this build, so the window never shows
	// files cached from an older version (storage stays shared: same origin).
	files := http.StripPrefix("/"+buildID, http.FileServer(http.FS(assets)))
	mux.Handle("/"+buildID+"/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		files.ServeHTTP(w, r)
	}))
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
	// Printers installed in the OS and direct (dialog-free) printing.
	mux.HandleFunc("/api/printers", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-JayDymo") != token {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		names, def, err := listPrinters()
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotImplemented)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"printers": names, "default": def})
	})
	mux.HandleFunc("/api/print", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-JayDymo") != token || r.Method != http.MethodPost {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		var job printJob
		if err := json.NewDecoder(io.LimitReader(r.Body, 64<<20)).Decode(&job); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		raw, err := base64.StdEncoding.DecodeString(job.PNG)
		if err != nil {
			http.Error(w, "bad image", http.StatusBadRequest)
			return
		}
		img, err := png.Decode(bytes.NewReader(raw))
		if err != nil {
			http.Error(w, "bad image", http.StatusBadRequest)
			return
		}
		if err := printImage(job, img); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	return mux
}

// printJob is one label print request from the editor.
type printJob struct {
	Printer   string  `json:"printer"`
	Copies    int     `json:"copies"`
	Landscape bool    `json:"landscape"`
	PaperW    float64 `json:"paperW"` // mm across the roll
	PaperH    float64 `json:"paperH"` // mm along the roll
	PaperID   string  `json:"paperId"`
	PNG       string  `json:"png"` // base64 PNG of the label as designed, 300 dpi
}

func randomToken() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// buildID is a short hash of all embedded app files.
var buildID = func() string {
	h := sha256.New()
	fs.WalkDir(assets, ".", func(p string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			b, _ := assets.ReadFile(p)
			h.Write([]byte(p))
			h.Write(b)
		}
		return nil
	})
	return fmt.Sprintf("b%x", h.Sum(nil)[:6])
}()
