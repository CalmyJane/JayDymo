//go:build !windows

// On macOS/Linux, JayDymo runs as a local server: open the printed URL in a browser.
package main

import (
	"fmt"
	"os"
)

func main() {
	start, err := startServer(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("JayDymo running at", start)
	select {}
}
