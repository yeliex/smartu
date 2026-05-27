#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

const options = parseArgs(process.argv.slice(2));
const nodeEntry = path.join(rootDir, "dist", "node.mjs");
const { compressImage } = await import(pathToFileURL(nodeEntry).href);
const samples = await collectFiles(options.samplesDir);
const smartuOutputDir = options.outputDir ?? path.join(rootDir, "benchmarks", "out", timestamp());
const rows = [];

await fs.mkdir(smartuOutputDir, { recursive: true });

for (const sample of samples) {
  const buffer = await fs.readFile(sample);
  const sourceSize = (await fs.stat(sample)).size;
  const result = await compressImage(buffer, {
    formats: ["auto", "webp"],
  });
  const smartuPath = await writePrimaryOutput(sample, smartuOutputDir, result);
  const zhituPath = options.zhituOutputDir ? await findZhituOutput(options.zhituOutputDir, sample) : undefined;
  const zhituSize = zhituPath ? (await fs.stat(zhituPath)).size : undefined;

  rows.push({
    sample,
    format: result.metadata.realFormat,
    branch: result.plan.branch,
    sourceSize,
    smartuPath,
    smartuSize: result.primary.size,
    smartuSavedBytes: sourceSize - result.primary.size,
    smartuSavedPercent: percent(sourceSize - result.primary.size, sourceSize),
    zhituPath,
    zhituSize,
    smartuVsZhituBytes: zhituSize === undefined ? undefined : result.primary.size - zhituSize,
  });
}

const reportPath = path.join(smartuOutputDir, "benchmark-report.json");
await fs.writeFile(reportPath, `${JSON.stringify(rows, null, 2)}\n`);
printSummary(rows, reportPath);

function parseArgs(args) {
  let samplesDir;
  let zhituOutputDir;
  let outputDir;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--samples") {
      samplesDir = path.resolve(readValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg === "--zhitu-output") {
      zhituOutputDir = path.resolve(readValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg === "--out") {
      outputDir = path.resolve(readValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown option: ${arg ?? ""}`);
  }

  if (!samplesDir) {
    printUsage();
    throw new Error("Missing --samples directory.");
  }

  return {
    samplesDir,
    zhituOutputDir,
    outputDir,
  };
}

function readValue(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${option}`);
  }

  return value;
}

async function collectFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && imageExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

async function findZhituOutput(directory, sample) {
  const sampleName = path.parse(sample).name;
  const files = await collectFiles(directory);
  return files.find((file) => path.parse(file).name === sampleName);
}

async function writePrimaryOutput(sample, outputDir, result) {
  const source = path.parse(sample);
  const outputPath = path.join(outputDir, `${source.name}.${result.metadata.realFormat}`);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, result.primary.buffer);
  return outputPath;
}

function printSummary(rows, reportPath) {
  const sourceBytes = rows.reduce((sum, row) => sum + row.sourceSize, 0);
  const smartuBytes = rows.reduce((sum, row) => sum + row.smartuSize, 0);
  const comparedRows = rows.filter((row) => typeof row.zhituSize === "number");

  process.stdout.write(`samples: ${rows.length}\n`);
  process.stdout.write(`source: ${sourceBytes} bytes\n`);
  process.stdout.write(`smartu: ${smartuBytes} bytes (${percent(sourceBytes - smartuBytes, sourceBytes)}% saved)\n`);
  process.stdout.write(`zhitu comparisons: ${comparedRows.length}\n`);
  process.stdout.write(`report: ${reportPath}\n`);
}

function percent(value, total) {
  if (total === 0) {
    return 0;
  }

  return Math.round((value / total) * 10_000) / 100;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function printUsage() {
  process.stdout.write(`Usage: node scripts/benchmark-strategy.mjs --samples <dir> [--zhitu-output <dir>] [--out <dir>]

Runs Smartu against a representative image directory and writes benchmark-report.json.
If --zhitu-output is provided, files with matching basenames are compared by size.
Run pnpm build before this script so dist/node.mjs exists.
`);
}
