//go:build !windows

package main

import (
	"errors"
	"image"
)

var errNoDirectPrint = errors.New("direct printing is only available in the Windows app")

func listPrinters() ([]string, string, error) { return nil, "", errNoDirectPrint }

func printImage(job printJob, img image.Image) error { return errNoDirectPrint }
