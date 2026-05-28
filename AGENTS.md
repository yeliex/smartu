# AGENTS.md

## Zhitu Strategy Sources

The old Zhitu app is located at:

```text
/Applications/智图.app
```

Before implementing or changing compression strategy, reopen the old app source and verify the relevant branch. Do not implement strategy from memory alone.

Known source files:

```text
/Applications/智图.app/Contents/Resources/app/package.json
/Applications/智图.app/Contents/Resources/app/assets/js/img.js
/Applications/智图.app/Contents/Resources/app/assets/js/image.js
/Applications/智图.app/Contents/Resources/app/assets/js/logic.js
/Applications/智图.app/Contents/Resources/app/assets/js/testCheck.js
/Applications/智图.app/Contents/Resources/app/assets/js/function.js
```

Source responsibilities:

- `package.json`: compression-related dependency inventory, including `imagemagick`, `imagemin`, `imagemin-pngquant`, `imagemin-webp`, `pngquant`, `pngcrush`, `jpegquality`, `image-palette`, `imageinfo`, and `tinify`.
- `testCheck.js`: checks and installs ImageMagick. The old implementation depends on `/opt/ImageMagick/bin/convert` and `/opt/ImageMagick/bin/identify`.
- `img.js`: wraps image metadata extraction, actual format detection, JPEG source-quality estimation, PNG alpha detection, PNG8 detection, and low-level ImageMagick/pngquant/pngcrush/WebP/GIF operations.
- `image.js`: core strategy branches. This file contains PNG, JPEG, GIF, and PNG8 processing flows, quality thresholds, automatic format-conversion candidates, and size comparison logic.
- `logic.js`: batch processing, concurrency control, output directory handling, temporary directory handling, original-file replacement, and quality-button mapping.
- `function.js`: file selection, recursive directory scanning, copying, and temporary directory cleanup. It also contains old app network-reporting behavior, which must not be reproduced in Smartu.

## Strategy Implementation Requirements

- Actual image format detection must not trust file extensions alone.
- PNG strategy must verify the old thresholds for alpha, color count, image area, file size, and quality ranges.
- JPEG strategy must verify source-quality estimation and recompression quality selection.
- Automatic format conversion must verify candidate-generation conditions, output naming, and size comparison rules.
- Original-file replacement must be an explicit option, and replacement should happen only when compressed output is smaller.
- Old app network reporting, version checks, and plugin installation are not part of the core compression strategy and must not be directly reproduced.
- If later analysis finds new strategy sources or corrects prior understanding, update this file before changing implementation.

## Development Constraints

- Use pnpm.
- Use TypeScript + ESM.
- Add dependencies through package manager commands. Do not hand-edit dependency fields.
- Implement the library and CLI first, then build browser compression on top of the library.
- Browser behavior must use the shared compression library. Do not duplicate strategy logic for the browser runtime.
- The website/browser demo must resolve `smartu` to the TypeScript browser source during page builds, for example through `page/tsconfig.json` path mapping to `../src/browser.ts`; do not require page-only builds or Vercel deployments to build the root package `dist` first.
- Browser original-file replacement is only an enhancement for File System Access API capable browsers. Unsupported browsers should fall back to download or ZIP export.
- Avoid extracting helpers for a single call site. Strategy abstractions must serve reuse across Node, CLI, and browser runtimes.
- Use `rtk` for validation commands.
