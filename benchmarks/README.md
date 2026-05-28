# Smartu Strategy Benchmark

The benchmark compares Smartu output against representative PNG, JPEG, and WebP samples.

Run Smartu only:

```bash
pnpm build
node scripts/benchmark-strategy.mjs --samples /path/to/samples
```

Compare Smartu with files already processed by the old Zhitu app:

```bash
pnpm build
node scripts/benchmark-strategy.mjs \
  --samples /path/to/original-samples \
  --zhitu-output /path/to/zhitu-output
```

The script writes compressed files and `benchmark-report.json` under `benchmarks/out/<timestamp>` unless `--out` is provided.
Matching with old Zhitu output is by basename, so keep each sample's output name aligned with the original file.
