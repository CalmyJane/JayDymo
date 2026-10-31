//go:build ignore

// Generates rsrc_windows_amd64.syso (app icon + manifest) for the Windows build.
//
//	go run build/winres/gen.go
//
// Writes a minimal COFF object with a .rsrc section that the Go linker embeds
// into JayDymo.exe. No third-party tools needed.
package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image/png"
	"os"
	"sort"
)

const manifest = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity type="win32" name="JayDymo" version="1.0.0.0" processorArchitecture="*"/>
  <description>JayDymo label editor</description>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security>
  </trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/>
      <supportedOS Id="{1f676c76-80e1-4239-95bb-83d0f6d0da78}"/>
    </application>
  </compatibility>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2, PerMonitor</dpiAwareness>
    </windowsSettings>
  </application>
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/>
    </dependentAssembly>
  </dependency>
</assembly>
`

const (
	rtIcon      = 3
	rtGroupIcon = 14
	rtManifest  = 24
	langEnUS    = 1033
)

type res struct {
	typ, id uint32
	data    []byte
}

func main() {
	var resources []res
	group := new(bytes.Buffer)
	sizes := []int{16, 24, 32, 48, 64, 256}
	binary.Write(group, binary.LittleEndian, []uint16{0, 1, uint16(len(sizes))})
	for i, s := range sizes {
		b, err := os.ReadFile(fmt.Sprintf("build/winres/icon%d.png", s))
		check(err)
		img, err := png.DecodeConfig(bytes.NewReader(b))
		check(err)
		if img.Width != s || img.Height != s {
			panic(fmt.Sprintf("icon%d.png is %dx%d", s, img.Width, img.Height))
		}
		id := uint32(i + 1)
		resources = append(resources, res{rtIcon, id, b})
		dim := byte(s)
		if s >= 256 {
			dim = 0
		}
		group.Write([]byte{dim, dim, 0, 0})
		binary.Write(group, binary.LittleEndian, uint16(1))  // planes
		binary.Write(group, binary.LittleEndian, uint16(32)) // bit count
		binary.Write(group, binary.LittleEndian, uint32(len(b)))
		binary.Write(group, binary.LittleEndian, uint16(id))
	}
	resources = append(resources, res{rtGroupIcon, 1, group.Bytes()}, res{rtManifest, 1, []byte(manifest)})
	check(os.WriteFile("rsrc_windows_amd64.syso", coff(resources), 0o644))
	fmt.Println("wrote rsrc_windows_amd64.syso")
}

// coff lays out a resource directory tree (type -> id -> language -> data).
func coff(resources []res) []byte {
	types := map[uint32][]res{}
	var typeIDs []uint32
	for _, r := range resources {
		if _, ok := types[r.typ]; !ok {
			typeIDs = append(typeIDs, r.typ)
		}
		types[r.typ] = append(types[r.typ], r)
	}
	sort.Slice(typeIDs, func(i, j int) bool { return typeIDs[i] < typeIDs[j] })

	// sizes of the directory part
	dirSize := func(n int) int { return 16 + 8*n }
	off := dirSize(len(typeIDs))
	typeDirOff := map[uint32]int{}
	for _, t := range typeIDs {
		typeDirOff[t] = off
		off += dirSize(len(types[t]))
	}
	langDirOff := map[[2]uint32]int{}
	for _, t := range typeIDs {
		for _, r := range types[t] {
			langDirOff[[2]uint32{t, r.id}] = off
			off += dirSize(1)
		}
	}
	entryOff := map[[2]uint32]int{}
	for _, t := range typeIDs {
		for _, r := range types[t] {
			entryOff[[2]uint32{t, r.id}] = off
			off += 16
		}
	}
	dataOff := map[[2]uint32]int{}
	for _, t := range typeIDs {
		for _, r := range types[t] {
			off = (off + 7) &^ 7
			dataOff[[2]uint32{t, r.id}] = off
			off += len(r.data)
		}
	}
	sec := make([]byte, (off+7)&^7)
	le := binary.LittleEndian
	dirHeader := func(at, n int) { le.PutUint16(sec[at+14:], uint16(n)) } // all ids, no names
	dirEntry := func(at int, id uint32, target int, sub bool) {
		le.PutUint32(sec[at:], id)
		v := uint32(target)
		if sub {
			v |= 0x80000000
		}
		le.PutUint32(sec[at+4:], v)
	}
	dirHeader(0, len(typeIDs))
	var relocs []int
	for i, t := range typeIDs {
		dirEntry(16+8*i, t, typeDirOff[t], true)
		dirHeader(typeDirOff[t], len(types[t]))
		for j, r := range types[t] {
			k := [2]uint32{t, r.id}
			dirEntry(typeDirOff[t]+16+8*j, r.id, langDirOff[k], true)
			dirHeader(langDirOff[k], 1)
			dirEntry(langDirOff[k]+16, langEnUS, entryOff[k], false)
			le.PutUint32(sec[entryOff[k]:], uint32(dataOff[k])) // relocated to an RVA by the linker
			le.PutUint32(sec[entryOff[k]+4:], uint32(len(r.data)))
			relocs = append(relocs, entryOff[k])
			copy(sec[dataOff[k]:], r.data)
		}
	}

	out := new(bytes.Buffer)
	const hdr, shdr = 20, 40
	relocPtr := hdr + shdr + len(sec)
	symPtr := relocPtr + 10*len(relocs)
	binary.Write(out, le, uint16(0x8664)) // AMD64
	binary.Write(out, le, uint16(1))      // sections
	binary.Write(out, le, uint32(0))      // timestamp
	binary.Write(out, le, uint32(symPtr))
	binary.Write(out, le, uint32(1)) // symbols
	binary.Write(out, le, uint16(0)) // optional header
	binary.Write(out, le, uint16(0)) // characteristics
	out.WriteString(".rsrc\x00\x00\x00")
	binary.Write(out, le, []uint32{0, 0, uint32(len(sec)), hdr + shdr, uint32(relocPtr), 0})
	binary.Write(out, le, []uint16{uint16(len(relocs)), 0})
	binary.Write(out, le, uint32(0x40000040)) // initialized data | read
	out.Write(sec)
	for _, r := range relocs {
		binary.Write(out, le, uint32(r))
		binary.Write(out, le, uint32(0)) // symbol index
		binary.Write(out, le, uint16(3)) // IMAGE_REL_AMD64_ADDR32NB
	}
	out.WriteString(".rsrc\x00\x00\x00")
	binary.Write(out, le, uint32(0))
	binary.Write(out, le, uint16(1)) // section number
	binary.Write(out, le, uint16(0))
	out.WriteByte(3) // static
	out.WriteByte(0)
	binary.Write(out, le, uint32(4)) // empty string table
	return out.Bytes()
}

func check(err error) {
	if err != nil {
		panic(err)
	}
}
