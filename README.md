# Smartu

## Codex Skill

Install the Smartu image compression skill:

```bash
npx skills add https://github.com/yeliex/smartu -g
```

Or ask an LLM/agent that can install skills:

```text
skill install https://github.com/yeliex/smartu
```

Smartu is an intelligent image compression project inspired by Zhitu from the Tencent ISUX team.

It is built for developers, designers, and content teams who need reliable image optimization in local tools, command-line workflows, websites, or build pipelines.

Instead of blindly applying one compression setting to every file, Smartu aims to inspect each image, choose an appropriate output format, and apply practical compression heuristics that keep visual quality as stable as possible while still reducing bytes. Its core value is the decision layer around compression: how images are classified, when a format conversion should be attempted, what quality level should be used, and when the original file should be preserved because the compressed result is not better.

## What Smartu Does

- Detects the actual image format instead of relying only on the file extension.
- Chooses a suitable compression path for common image types such as PNG, JPEG, and WebP.
- Evaluates whether converting an image to another format is likely to produce a better result.
- Uses a set of experience-based thresholds to select an appropriate compression ratio with minimal visible quality loss.
- Compares compression candidates and keeps the smaller result only when it improves on the source.
- Supports local workflows where replacing the original file must be an explicit and safe action.

## Project Direction

Smartu focuses on rebuilding the useful parts of Zhitu's image optimization workflow in a modern, maintainable codebase. The long-term direction is to provide the same compression strategy through:

- a shared TypeScript library,
- a CLI for local and batch compression,
- a browser runtime for in-page image optimization,
- and a website for demos, documentation, and practical usage examples.

## Usage

Build the package before running the local CLI or benchmark scripts:

```bash
pnpm build
```

Use the root package import. Smartu exposes runtime-specific APIs through conditional exports: Node resolves the `node` condition to the Sharp-based runtime by default, and browser bundlers resolve the `browser` condition to the WASM codec runtime.

```ts
import { createCompressionPlan } from "smartu";
```

Both Node and browser runtimes expose the same main API names:

```ts
import { analyzeImage, compressImage } from "smartu";
```

Node callers pass a `Uint8Array` buffer. File reading, output paths, and original-file replacement belong in the CLI or application layer:

```ts
import { readFile, writeFile } from "node:fs/promises";
import { compressImage } from "smartu";

const input = await readFile("input.png");
const result = await compressImage(input);
await writeFile("output.png", result.primary.buffer);
```

Browser callers pass a `Blob` or `Uint8Array` input to the same `compressImage` API.

## CLI

After installing the package, compress files or directories into a separate output directory:

```bash
smartu ./images --out ./compressed
```

Try automatic PNG/JPEG format conversion and generate smaller WebP candidates when available:

```bash
smartu ./images --format auto,webp
```

Replace original files only when the primary compressed output is smaller:

```bash
smartu ./images --replace
```

Useful options:

- `--replace`: replace the original path only when the primary output is smaller.
- `--recursive`: recurse into input directories.
- `--format auto,png,jpg,jpeg,webp`: choose one or more output formats. When omitted, Smartu keeps the source format. `auto` tries PNG/JPEG conversion only; WebP requires `webp`. `jpeg` is treated as `jpg`.
- `--quality auto|q1..q6|<number>`: choose automatic strategy quality, a preset, or a numeric adjustment.
- `--json`: emit machine-readable results.

## Browser Runtime

The browser runtime uses the shared strategy model and WASM codecs for PNG, JPEG, and WebP decoding and encoding. PNG outputs are passed through OxiPNG for lossless optimization.

In Next.js App Router projects, import the browser runtime from a client-only boundary such as a component loaded with `next/dynamic(..., { ssr: false })`. If TypeScript needs to resolve the browser condition, add `customConditions: ["browser"]` to the app tsconfig. Image compression should stay in the browser and should not be pulled into SSR.

Unsupported original-file replacement falls back to download links in the website demo. File System Access API replacement can be added later without duplicating strategy logic.

## Benchmark

Run Smartu against representative samples:

```bash
node scripts/benchmark-strategy.mjs --samples /path/to/samples
```

Compare Smartu with output already produced by Zhitu:

```bash
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
