# Smartu

Smartu is an intelligent image compression project inspired by Zhitu from the Tencent ISUX team.

It is built for developers, designers, and content teams who need reliable image optimization in local tools, command-line workflows, websites, or build pipelines.

Instead of blindly applying one compression setting to every file, Smartu aims to inspect each image, choose an appropriate output format, and apply practical compression heuristics that keep visual quality as stable as possible while still reducing bytes. Its core value is the decision layer around compression: how images are classified, when a format conversion should be attempted, what quality level should be used, and when the original file should be preserved because the compressed result is not better.

## What Smartu Does

- Detects the actual image format instead of relying only on the file extension.
- Chooses a suitable compression path for common image types such as PNG, JPEG, GIF, and WebP.
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
