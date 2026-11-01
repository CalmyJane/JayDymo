package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFileAPI(t *testing.T) {
	dir := t.TempDir()
	lbl := filepath.Join(dir, "a.label")
	os.WriteFile(lbl, []byte("<DieCutLabel/>"), 0o644)
	srv := httptest.NewServer(handler("tok"))
	defer srv.Close()

	do := func(method, path, tok, body string) int {
		req, _ := http.NewRequest(method, srv.URL+"/api/file?path="+path, strings.NewReader(body))
		if tok != "" {
			req.Header.Set("X-JayDymo", tok)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res.StatusCode
	}
	if c := do("GET", lbl, "", ""); c != 403 {
		t.Errorf("no token: got %d", c)
	}
	if c := do("GET", filepath.Join(dir, "x.txt"), "tok", ""); c != 400 {
		t.Errorf("wrong extension: got %d", c)
	}
	if c := do("GET", lbl, "tok", ""); c != 200 {
		t.Errorf("read: got %d", c)
	}
	if c := do("POST", lbl, "tok", "<new/>"); c != 204 {
		t.Errorf("write: got %d", c)
	}
	if b, _ := os.ReadFile(lbl); string(b) != "<new/>" {
		t.Errorf("content not written: %q", b)
	}
	res, _ := http.Get(srv.URL + "/" + buildID + "/index.html")
	if res.StatusCode != 200 {
		t.Errorf("index: %d", res.StatusCode)
	}
}
