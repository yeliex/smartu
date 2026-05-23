# Smartu

Smartu is an intelligent image compression project inspired by Zhitu from the Tencent ISUX team.

It is built for developers, designers, and content teams who need reliable image optimization in local tools, command-line workflows, websites, or build pipelines.

Instead of blindly applying one compression setting to every file, Smartu inspects each image, chooses an appropriate output format, and applies practical compression heuristics that keep visual quality stable while reducing bytes. Its core value is the decision layer around compression: how images are classified, when a format conversion should be attempted, what quality level should be used, and when the original file should be preserved because the compressed result is not better.

## Current Outputs

- `smartu`: npm package exposing the shared compression strategy and runtime APIs.
- `smartu` CLI: local batch compression with optional safe replacement.
- browser condition export: browser runtime built on the same strategy model.
- `page/`: Next.js website with documentation and an in-browser compression demo.
- `scripts/benchmark-strategy.mjs`: repeatable strategy benchmark entry.

## Strategy Focus

Smartu keeps the old Zhitu behavior in explicit strategy branches:

- Detect actual image format from content before using file extensions.
- Route PNG, JPEG, GIF, WebP, and other supported formats through explicit strategy branches.
- Use PNG-specific signals such as color count, alpha channel, dimensions, and file size.
- Estimate JPEG source quality from quantization tables before choosing recompression quality.
- Evaluate automatic format conversion only when it is likely to produce a smaller acceptable output.
- Compare candidate outputs and keep the smaller one only when it improves on the source.
- Replace original files only through a safe local-file workflow.

## Package API

```ts
import { createCompressionPlan } from "smartu";
import { compressImageFile } from "smartu";
import { compressImageInBrowser } from "smartu";
```

The package uses conditional exports. Node resolves the `node` condition to the Node codec adapter, and browser bundlers resolve the `browser` condition to the browser runtime. Both runtime entries re-export the shared metadata model, quality selection helpers, result comparison model, and strategy planner.

## CLI

Build the package first:

```bash
pnpm build
```

Compress files or directories:

```bash
smartu ./images --out ./compressed
smartu ./images --webp
smartu ./images --replace --quality q5
```

Options:

- `--replace`: replace the original path only when the primary output is smaller.
- `--no-convert`: disable automatic PNG/JPEG conversion candidates.
- `--webp`: write a smaller WebP candidate beside the primary output.
- `--quality q1..q6`: apply the old Zhitu quality-button adjustment.
- `--json`: emit machine-readable results.

## Browser Runtime

The browser runtime uses the shared strategy model and browser codecs. It currently supports PNG, JPEG, and WebP encoding through Canvas APIs. GIF inputs are classified through the shared strategy, but the browser runtime keeps the source because browsers do not provide a native animated GIF encoder.

Unsupported original-file replacement falls back to download links in the website demo. File System Access API replacement can be added later without duplicating strategy logic.

## Benchmark

Run Smartu against representative samples:

```bash
pnpm build
node scripts/benchmark-strategy.mjs --samples /path/to/samples
```

Compare Smartu with output already produced by the old Zhitu app:

```bash
pnpm build
node scripts/benchmark-strategy.mjs \
  --samples /path/to/original-samples \
  --zhitu-output /path/to/zhitu-output
```

The benchmark writes compressed files and `benchmark-report.json` under `benchmarks/out/<timestamp>` unless `--out` is provided.

## Website

Run the Next.js site:

```bash
pnpm build:page
pnpm --dir page start
```

For local development:

```bash
pnpm build
pnpm dev:page
```
