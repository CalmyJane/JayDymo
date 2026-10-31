package main

// Direct printing through the Windows printer driver (GDI), without a print dialog.

import (
	"errors"
	"fmt"
	"image"
	"image/draw"
	"math"
	"strings"
	"syscall"
	"unsafe"
)

var (
	winspool              = syscall.NewLazyDLL("winspool.drv")
	procEnumPrinters      = winspool.NewProc("EnumPrintersW")
	procGetDefaultPrinter = winspool.NewProc("GetDefaultPrinterW")
	procOpenPrinter       = winspool.NewProc("OpenPrinterW")
	procClosePrinter      = winspool.NewProc("ClosePrinter")
	procDocumentProps     = winspool.NewProc("DocumentPropertiesW")
	procDeviceCaps        = winspool.NewProc("DeviceCapabilitiesW")

	gdi32              = syscall.NewLazyDLL("gdi32.dll")
	procCreateDC       = gdi32.NewProc("CreateDCW")
	procDeleteDC       = gdi32.NewProc("DeleteDC")
	procStartDoc       = gdi32.NewProc("StartDocW")
	procEndDoc         = gdi32.NewProc("EndDoc")
	procAbortDoc       = gdi32.NewProc("AbortDoc")
	procStartPage      = gdi32.NewProc("StartPage")
	procEndPage        = gdi32.NewProc("EndPage")
	procGetDeviceCaps  = gdi32.NewProc("GetDeviceCaps")
	procStretchDIBits  = gdi32.NewProc("StretchDIBits")
	procSetStretchMode = gdi32.NewProc("SetStretchBltMode")
)

const (
	printerEnumLocal       = 2
	printerEnumConnections = 4

	dmOutBuffer = 2
	dmInBuffer  = 8

	dmFieldOrientation = 0x1
	dmFieldPaperSize   = 0x2
	dmFieldPaperLength = 0x4
	dmFieldPaperWidth  = 0x8
	dmFieldCopies      = 0x100
	dmPaperUser        = 256

	dcPapers     = 2
	dcPaperSize  = 3
	dcPaperNames = 16

	physicalWidth   = 110
	physicalHeight  = 111
	physicalOffsetX = 112
	physicalOffsetY = 113

	// DEVMODEW field offsets
	offFields      = 72
	offOrientation = 76
	offPaperSize   = 78
	offPaperLength = 80
	offPaperWidth  = 82
	offCopies      = 86
)

func utf16(s string) *uint16 { p, _ := syscall.UTF16PtrFromString(s); return p }

func listPrinters() (names []string, def string, err error) {
	var needed, count uint32
	flags := uintptr(printerEnumLocal | printerEnumConnections)
	procEnumPrinters.Call(flags, 0, 4, 0, 0, uintptr(unsafe.Pointer(&needed)), uintptr(unsafe.Pointer(&count)))
	if needed > 0 {
		buf := make([]byte, needed)
		r, _, e := procEnumPrinters.Call(flags, 0, 4, uintptr(unsafe.Pointer(&buf[0])), uintptr(needed),
			uintptr(unsafe.Pointer(&needed)), uintptr(unsafe.Pointer(&count)))
		if r == 0 {
			return nil, "", e
		}
		type printerInfo4 struct {
			name, server *uint16
			attributes   uint32
		}
		infos := unsafe.Slice((*printerInfo4)(unsafe.Pointer(&buf[0])), count)
		for _, in := range infos {
			names = append(names, syscall.UTF16ToString(unsafe.Slice(in.name, 256)))
		}
	}
	var size uint32 = 256
	b := make([]uint16, size)
	if r, _, _ := procGetDefaultPrinter.Call(uintptr(unsafe.Pointer(&b[0])), uintptr(unsafe.Pointer(&size))); r != 0 {
		def = syscall.UTF16ToString(b)
	}
	return names, def, nil
}

// findPaper returns the driver's paper id whose size matches w×h mm (portrait), or 0.
func findPaper(printer string, wmm, hmm float64, hint string) int16 {
	dev := utf16(printer)
	n, _, _ := procDeviceCaps.Call(uintptr(unsafe.Pointer(dev)), 0, dcPapers, 0, 0)
	if int32(n) <= 0 || n > 4096 {
		return 0
	}
	ids := make([]uint16, n)
	sizes := make([]int32, 2*n)
	names := make([]uint16, 64*n)
	procDeviceCaps.Call(uintptr(unsafe.Pointer(dev)), 0, dcPapers, uintptr(unsafe.Pointer(&ids[0])), 0)
	procDeviceCaps.Call(uintptr(unsafe.Pointer(dev)), 0, dcPaperSize, uintptr(unsafe.Pointer(&sizes[0])), 0)
	procDeviceCaps.Call(uintptr(unsafe.Pointer(dev)), 0, dcPaperNames, uintptr(unsafe.Pointer(&names[0])), 0)
	best, bestScore := int16(0), math.MaxFloat64
	for i := 0; i < int(n); i++ {
		pw, ph := float64(sizes[2*i])/10, float64(sizes[2*i+1])/10 // 0.1 mm units
		d := math.Abs(pw-wmm) + math.Abs(ph-hmm)
		if d2 := math.Abs(pw-hmm) + math.Abs(ph-wmm); d2 < d {
			d = d2
		}
		if d > 3 {
			continue
		}
		name := syscall.UTF16ToString(names[64*i : 64*i+64])
		if hint != "" && strings.Contains(name, hint) {
			d -= 2 // prefer the paper named like the label (e.g. "99014")
		}
		if d < bestScore {
			best, bestScore = int16(ids[i]), d
		}
	}
	return best
}

// printImage prints img (already rotated as on screen) on a label of w×h mm (across × along the roll).
func printImage(job printJob, img image.Image) error {
	name := utf16(job.Printer)
	var hPrinter uintptr
	if r, _, e := procOpenPrinter.Call(uintptr(unsafe.Pointer(name)), uintptr(unsafe.Pointer(&hPrinter)), 0); r == 0 {
		return fmt.Errorf("cannot open printer %q: %v", job.Printer, e)
	}
	defer procClosePrinter.Call(hPrinter)

	size, _, _ := procDocumentProps.Call(0, hPrinter, uintptr(unsafe.Pointer(name)), 0, 0, 0)
	if int32(size) <= 0 {
		return errors.New("cannot read printer settings")
	}
	dm := make([]byte, size)
	if r, _, _ := procDocumentProps.Call(0, hPrinter, uintptr(unsafe.Pointer(name)), uintptr(unsafe.Pointer(&dm[0])), 0, dmOutBuffer); int32(r) < 0 {
		return errors.New("cannot read printer settings")
	}
	put16 := func(off int, v int16) { *(*int16)(unsafe.Pointer(&dm[off])) = v }
	fields := (*uint32)(unsafe.Pointer(&dm[offFields]))

	// Paper: the driver's matching DYMO paper, or a custom size.
	if id := findPaper(job.Printer, job.PaperW, job.PaperH, job.PaperID); id != 0 {
		put16(offPaperSize, id)
		*fields = (*fields | dmFieldPaperSize) &^ (dmFieldPaperLength | dmFieldPaperWidth)
	} else {
		put16(offPaperSize, dmPaperUser)
		put16(offPaperWidth, int16(math.Round(job.PaperW*10)))
		put16(offPaperLength, int16(math.Round(job.PaperH*10)))
		*fields |= dmFieldPaperSize | dmFieldPaperWidth | dmFieldPaperLength
	}
	// Let the driver rotate landscape labels exactly like DYMO's own software does.
	orient := int16(1)
	if job.Landscape {
		orient = 2
	}
	put16(offOrientation, orient)
	put16(offCopies, 1)
	*fields |= dmFieldOrientation | dmFieldCopies
	procDocumentProps.Call(0, hPrinter, uintptr(unsafe.Pointer(name)), uintptr(unsafe.Pointer(&dm[0])), uintptr(unsafe.Pointer(&dm[0])), dmInBuffer|dmOutBuffer)

	hdc, _, e := procCreateDC.Call(0, uintptr(unsafe.Pointer(name)), 0, uintptr(unsafe.Pointer(&dm[0])))
	if hdc == 0 {
		return fmt.Errorf("cannot start printing: %v", e)
	}
	defer procDeleteDC.Call(hdc)

	caps := func(i uintptr) int32 { r, _, _ := procGetDeviceCaps.Call(hdc, i); return int32(r) }
	pw, ph, ox, oy := caps(physicalWidth), caps(physicalHeight), caps(physicalOffsetX), caps(physicalOffsetY)

	// 32-bit top-down BGRA bitmap
	b := img.Bounds()
	rgba := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(rgba, rgba.Bounds(), img, b.Min, draw.Src)
	px := rgba.Pix
	for i := 0; i < len(px); i += 4 {
		px[i], px[i+2] = px[i+2], px[i]
	}
	type bitmapInfoHeader struct {
		Size                   uint32
		Width, Height          int32
		Planes, BitCount       uint16
		Compression, SizeImage uint32
		XPels, YPels           int32
		ClrUsed, ClrImportant  uint32
	}
	bih := bitmapInfoHeader{Size: 40, Width: int32(b.Dx()), Height: -int32(b.Dy()), Planes: 1, BitCount: 32}

	doc := struct {
		Size                     int32
		DocName, Output, DataTyp *uint16
		Type                     uint32
	}{DocName: utf16("JayDymo label")}
	doc.Size = int32(unsafe.Sizeof(doc))
	if r, _, e := procStartDoc.Call(hdc, uintptr(unsafe.Pointer(&doc))); int32(r) <= 0 {
		return fmt.Errorf("print job refused: %v", e)
	}
	procSetStretchMode.Call(hdc, 3) // COLORONCOLOR: keep crisp black/white pixels
	for i := 0; i < max(1, job.Copies); i++ {
		procStartPage.Call(hdc)
		// Map the label image onto the whole physical page (its printable origin is offset by the margins).
		r, _, _ := procStretchDIBits.Call(hdc, uintptr(int(-ox)), uintptr(int(-oy)), uintptr(pw), uintptr(ph),
			0, 0, uintptr(b.Dx()), uintptr(b.Dy()), uintptr(unsafe.Pointer(&px[0])), uintptr(unsafe.Pointer(&bih)), 0, 0x00CC0020)
		if int32(r) == 0 {
			procAbortDoc.Call(hdc)
			return errors.New("the printer driver rejected the image")
		}
		procEndPage.Call(hdc)
	}
	procEndDoc.Call(hdc)
	return nil
}
