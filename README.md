# Smartu

Smartu is a modern rebuild of the old Zhitu image compression app.

The core value of this project is not the UI shell. The valuable part is to recover, validate, and maintain Zhitu's compression strategy: how it classifies images, chooses codecs, picks quality levels, compares alternative outputs, and decides whether a compressed file is safe to replace the original.

## Goals

- Rebuild the Zhitu workflow with a maintainable modern codebase.
- Preserve the practical compression behavior that made Zhitu useful.
- Provide the same compression strategy through a library, CLI, and browser app.
- Keep local-file workflows first: compress a file and replace the original only when that is explicitly requested and safe.

## Planned Outputs

- `smartu`: npm package exposing the shared compression strategy and runtime APIs.
- `smartu` CLI: `npx smartu ...` for local batch compression and replacement workflows.
- `smartu/browser`: browser runtime for in-page compression.
- `page/`: deployable Next.js website for documentation, demos, and SEO.

## Strategy Focus

The first implementation target is the compression strategy, especially the behavior observed in Zhitu:

- Detect actual image format instead of trusting file extension.
- Route PNG, JPEG, GIF, WebP, and other supported formats through explicit strategy branches.
- Use PNG-specific signals such as color count, alpha channel, dimensions, and file size.
- Estimate JPEG source quality before choosing a recompression quality.
- Evaluate automatic format conversion only when it is likely to produce a smaller acceptable output.
- Compare candidate outputs and keep the smaller one only when it improves on the source.
- Replace original files only through a safe local-file workflow.

## Development Order

1. Compression library.
   Define the strategy model, image metadata model, result comparison rules, and codec adapter boundaries.

2. CLI.
   Build the local workflow first because it can directly support the core Zhitu use case: drag-or-select files, compress them, and optionally replace originals.

3. Strategy benchmark.
   Compare Smartu output against the old Zhitu app on representative PNG, JPEG, and GIF samples. Use size reduction and visual quality as acceptance criteria.

4. Browser runtime.
   Add browser-compatible codecs and file handling on top of the shared library. Chromium browsers can later support original-file replacement through File System Access APIs; unsupported browsers should fall back to download or ZIP export.

5. Website.
   Build the Next.js site after the core compression behavior is proven. The site should document the strategy, expose a browser demo, and capture SEO traffic for image compression use cases.

## Repository Structure

```text
smartu/
  src/              # npm package entry points
  page/             # Next.js website
  package.json      # smartu npm package
  pnpm-workspace.yaml
```

The repository is currently scaffold-only. The entry files are intentionally empty until the compression strategy and public API boundaries are implemented.
