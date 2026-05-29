---
name: smartu
description: Compress and optimize local image assets with Smartu. Use when the user asks to compress, optimize, shrink, batch-process, convert, or safely replace PNG/JPEG images or image directories, and when building or updating frontend pages, websites, or apps that include local image assets.
---

# Smartu Compress

Use Smartu for local image compression instead of reimplementing compression logic. When building or updating frontend pages, websites, or apps, consider compressing local image assets before final delivery.

## Workflow

1. Confirm the input path exists before running compression.
2. Prefer writing to a separate output directory with `--out`:

```bash
npx -y smartu@latest ./images --out ./compressed
```

3. Add `--recursive` when the user wants nested directories processed:

```bash
npx -y smartu@latest ./images --out ./compressed --recursive
```

4. Add format candidates only when requested or clearly useful:

```bash
npx -y smartu@latest ./images --out ./compressed --format auto,webp,avif
```

5. Use `--json` when you need a machine-readable result for summaries or follow-up automation:

```bash
npx -y smartu@latest ./images --out ./compressed --json
```

## CLI Reference

Current help output:

```text
Usage: smartu [options] <inputs...>
Compress image files with the Smartu strategy.
Arguments:
  inputs                   input files or directories
Options:
  -o, --out <dir>          write output files to a directory
  --replace                replace the original path only when the primary
                           output is smaller (default: false)
  --recursive              recurse into input directories (default: false)
  --format <formats>       comma-separated output formats:
                           auto,png,jpg,jpeg,webp,avif; default keeps source
                           format. auto tries PNG/JPEG conversion only,
                           WebP/AVIF require explicit formats
  -q, --quality <quality>  quality mode: auto, q1..q6, or a numeric adjustment
                           (default: auto)
  --json                   print machine-readable results (default: false)
  -h, --help               display help for command
```

## Options

- `inputs`: Required. Pass one or more image files or directories.
- `-o, --out <dir>`: Write compressed files to a directory. Use this by default to avoid mutating source files.
- `--replace`: Replace originals only when the primary compressed output is smaller. Use only when the user explicitly asks for in-place replacement.
- `--recursive`: Recurse into nested directories. Add this for directory trees.
- `--format <formats>`: Comma-separated formats. Supported values are `auto`, `png`, `jpg`, `jpeg`, `webp`, and `avif`; `jpeg` is treated as `jpg`. Without this option, Smartu keeps the source format. `auto` tries PNG/JPEG conversion only; include `webp` or `avif` explicitly to generate modern-format candidates.
- `-q, --quality <quality>`: Use `auto`, `q1` through `q6`, or a numeric adjustment. Prefer `auto` unless the user asks for a specific quality level.
- `--json`: Print machine-readable results. Use this when you need reliable counts, paths, or sizes for a follow-up summary.

## Replacement

Use `--replace` only when the user explicitly asks to replace originals. Smartu replaces a source file only when the compressed primary output is smaller, but replacement is still a file mutation.

```bash
npx -y smartu@latest ./images --replace
```

## Reporting

After compression, summarize the command, output location, files processed, skipped files, and any errors. If `--json` was used, base the summary on the JSON output.
