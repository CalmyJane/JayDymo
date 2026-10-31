#!/bin/sh
# Builds dist/JayDymo.exe (Windows, 64-bit). Works on Windows (Git Bash), macOS and Linux with Go installed.
set -e
cd "$(dirname "$0")"
go run build/winres/gen.go
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-H windowsgui -s -w" -o dist/JayDymo.exe .
echo "Built dist/JayDymo.exe"
