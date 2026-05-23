#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { compressImageFile, type FileCompressionResult } from "./node.js";
import type { QualityPreset } from "./index.js";

interface CliOptions {
  readonly inputs: readonly string[];
  readonly outputDir?: string;
  readonly replaceOriginal: boolean;
  readonly recursive: boolean;
  readonly allowFormatConversion: boolean;
  readonly generateWebp: boolean;
  readonly qualityPreset?: QualityPreset;
  readonly qualityAdjustment?: number;
  readonly json: boolean;
}

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const qualityPresets = new Set<QualityPreset>(["q1", "q2", "q3", "q4", "q5", "q6"]);

try {
  const options = parseArgs(process.argv.slice(2));
  const files = await collectInputFiles(options.inputs, options.recursive);

  if (files.length === 0) {
    throw new Error("No image files found.");
  }

  const results: FileCompressionResult[] = [];

  for (const file of files) {
    const result = await compressImageFile(file, options);
    results.push(result);

    if (!options.json) {
      printHumanResult(result);
    }
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(results.map(toJsonResult), null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function parseArgs(args: readonly string[]): CliOptions {
  const inputs: string[] = [];
  let outputDir: string | undefined;
  let replaceOriginal = false;
  let recursive = true;
  let allowFormatConversion = true;
  let generateWebp = false;
  let qualityPreset: QualityPreset | undefined;
  let qualityAdjustment: number | undefined;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === undefined) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    if (arg === "--out" || arg === "-o") {
      outputDir = readValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--replace") {
      replaceOriginal = true;
      continue;
    }

    if (arg === "--recursive") {
      recursive = true;
      continue;
    }

    if (arg === "--no-recursive") {
      recursive = false;
      continue;
    }

    if (arg === "--no-convert") {
      allowFormatConversion = false;
      continue;
    }

    if (arg === "--webp") {
      generateWebp = true;
      continue;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--quality" || arg === "-q") {
      const value = readValue(args, index, arg);
      if (isQualityPreset(value)) {
        qualityPreset = value;
        qualityAdjustment = undefined;
      } else {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
          throw new Error(`Invalid quality value: ${value}`);
        }
        qualityAdjustment = parsed;
        qualityPreset = undefined;
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    inputs.push(arg);
  }

  if (inputs.length === 0) {
    printUsage();
    throw new Error("Missing input file or directory.");
  }

  return {
    inputs,
    outputDir,
    replaceOriginal,
    recursive,
    allowFormatConversion,
    generateWebp,
    qualityPreset,
    qualityAdjustment,
    json,
  };
}

function readValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`Missing value for ${option}`);
  }

  return value;
}

async function collectInputFiles(inputs: readonly string[], recursive: boolean): Promise<string[]> {
  const files: string[] = [];

  for (const input of inputs) {
    const resolved = path.resolve(input);
    const stat = await fs.stat(resolved);

    if (stat.isDirectory()) {
      files.push(...(await collectDirectoryFiles(resolved, recursive)));
    } else {
      files.push(resolved);
    }
  }

  return files;
}

async function collectDirectoryFiles(directory: string, recursive: boolean): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (recursive && entry.name !== "smartu-output") {
        files.push(...(await collectDirectoryFiles(fullPath, recursive)));
      }
      continue;
    }

    if (entry.isFile() && imageExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }

  return files;
}

function printHumanResult(result: FileCompressionResult): void {
  const sourceKb = toKb(result.metadata.size);
  const primaryKb = toKb(result.primary.size);
  const status = result.primary.compressed ? "compressed" : "kept";
  const alternatives = result.alternativePaths.length > 0 ? ` alternatives=${result.alternativePaths.length}` : "";

  process.stdout.write(
    `${status} ${result.sourcePath} -> ${result.primaryPath} ${sourceKb}KB -> ${primaryKb}KB${alternatives}\n`,
  );
}

function toJsonResult(result: FileCompressionResult): object {
  return {
    sourcePath: result.sourcePath,
    primaryPath: result.primaryPath,
    alternativePaths: result.alternativePaths,
    format: result.metadata.realFormat,
    visibleFormat: result.metadata.visibleFormat,
    width: result.metadata.width,
    height: result.metadata.height,
    sourceSize: result.metadata.size,
    outputSize: result.primary.size,
    compressed: result.primary.compressed,
    branch: result.plan.branch,
    reason: result.primary.reason,
  };
}

function toKb(size: number): number {
  return Math.ceil(size / 1024);
}

function isQualityPreset(value: string): value is QualityPreset {
  return qualityPresets.has(value as QualityPreset);
}

function printUsage(): void {
  process.stdout.write(`Usage: smartu [options] <file-or-directory...>

Options:
  -o, --out <dir>      Write output files to a directory (default: ./smartu-output)
      --replace        Replace the original path only when the primary output is smaller
      --no-recursive   Do not recurse into input directories
      --no-convert     Disable automatic PNG/JPEG format conversion candidates
      --webp           Also write a WebP candidate when it is smaller than the source
  -q, --quality <q>    Old Zhitu quality preset q1..q6, or a numeric adjustment
      --json           Print machine-readable results
  -h, --help           Show this help
`);
}
