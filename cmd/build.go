package cmd

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/k1LoW/mo/internal/build"
	"github.com/spf13/cobra"
)

var buildOutput string

var buildCmd = &cobra.Command{
	Use:   "build [DIR or FILE ...]",
	Short: "Build a static site from Markdown files or a directory",
	Long: `Build generates a self-contained static site from Markdown files.

When given a directory, it recursively scans for .md/.mdx files.
When given individual files, it bundles exactly those files.

The output is a directory containing index.html and all necessary assets,
with all file contents embedded. No server is needed to view the result.

Examples:
  mo build docs/                         Build from docs/ to docs-static/
  mo build docs/ -o dist/                Build from docs/ to dist/
  mo build .                             Build from current directory
  mo build README.md CHANGELOG.md        Build from specific files`,
	Args: cobra.MinimumNArgs(1),
	RunE: runBuild,
}

func init() {
	rootCmd.AddCommand(buildCmd)
	buildCmd.Flags().StringVarP(&buildOutput, "output", "o", "", "Output directory (default: <input>-static)")
}

func runBuild(_ *cobra.Command, args []string) error {
	// Determine if first arg is a directory
	firstAbs, err := filepath.Abs(args[0])
	if err != nil {
		return fmt.Errorf("cannot resolve path: %w", err)
	}

	info, err := os.Stat(firstAbs)
	if err != nil {
		return fmt.Errorf("path does not exist: %s", args[0])
	}

	if info.IsDir() {
		if len(args) > 1 {
			return fmt.Errorf("only one directory argument is allowed")
		}

		outputDir := buildOutput
		if outputDir == "" {
			outputDir = filepath.Base(firstAbs) + "-static"
		}
		absOutput, err := filepath.Abs(outputDir)
		if err != nil {
			return fmt.Errorf("cannot resolve output directory: %w", err)
		}

		fmt.Fprintf(os.Stderr, "mo: scanning %s for markdown files...\n", firstAbs)
		if err := build.BuildStaticSite(firstAbs, absOutput); err != nil {
			return err
		}
		fmt.Fprintf(os.Stderr, "mo: static site built to %s\n", absOutput)
		return nil
	}

	// File mode: all args are individual files
	var files []string
	for _, arg := range args {
		abs, err := filepath.Abs(arg)
		if err != nil {
			return fmt.Errorf("cannot resolve path %s: %w", arg, err)
		}
		fi, err := os.Stat(abs)
		if err != nil {
			return fmt.Errorf("file not found: %s", arg)
		}
		if fi.IsDir() {
			return fmt.Errorf("cannot mix files and directories: %s is a directory", arg)
		}
		files = append(files, abs)
	}

	outputDir := buildOutput
	if outputDir == "" {
		outputDir = "mo-static"
	}
	absOutput, err := filepath.Abs(outputDir)
	if err != nil {
		return fmt.Errorf("cannot resolve output directory: %w", err)
	}

	fmt.Fprintf(os.Stderr, "mo: building from %d file(s)...\n", len(files))
	if err := build.BuildStaticSiteFromFiles(files, absOutput); err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "mo: static site built to %s\n", absOutput)
	return nil
}
