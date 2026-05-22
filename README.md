# Smartu

Smartu is planned as a browser-first image compression toolkit with a shared npm package, a CLI, and a deployable Next.js website.

This repository is intentionally scaffold-only right now. Business implementation will be added after the browser file-access proof of concept and compression strategy are validated.

## Repository Structure

```text
smartu/
  src/              # npm package entry points
  page/             # Next.js website
  package.json      # smartu npm package
  pnpm-workspace.yaml
```

## Planned Package Outputs

- `smartu`: shared public API.
- `smartu/browser`: browser runtime entry.
- `smartu/node`: Node.js runtime entry.
- `smartu` CLI: `npx smartu ...`.

The current entry files are empty by design.

## Development Plan

1. Validate browser file access.
   Confirm `DataTransferItem.getAsFileSystemHandle()` and `FileSystemFileHandle.createWritable()` behavior in Chromium, then define fallback behavior for unsupported browsers.

2. Define public API boundaries.
   Keep strategy decisions separate from browser file access, Node file access, and codec adapters.

3. Add compression adapters.
   Evaluate browser-compatible WASM codecs and Node adapters separately before committing to a long-term dependency set.

4. Implement safe replacement.
   Replace local files only when explicitly requested and only when compressed output is smaller.

5. Build the website.
   Turn `page/` into an SEO-friendly product and documentation site after the core behavior is proven.

## Commands

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm dev:page
```
