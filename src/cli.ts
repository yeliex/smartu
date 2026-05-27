#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  compressImage,
  type CompressionOptions,
  type CompressionFormat,
  type CompressionResult,
  type QualityPreset,
} from "./node.js";

interface CliOptions extends CompressionOptions {
  readonly inputs: readonly string[];
  readonly outputDir?: string;
  readonly replaceOriginal: boolean;
  readonly recursive: boolean;
  readonly json: boolean;
}

interface FileCompressionResult extends CompressionResult {
  readonly sourcePath: string;
  readonly primaryPath: string;
  readonly alternativePaths: readonly string[];
  readonly visibleFormat?: string;
}

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const qualityPresets = new Set<QualityPreset>(["q1", "q2", "q3", "q4", "q5", "q6"]);
const outputFormats = new Set<CompressionFormat>(["auto", "png", "jpg", "webp"]);

/*
 * CLI owns filesystem concerns around the buffer-only package API: input
 * discovery, output path selection, replacement, and human/JSON reporting.
 */
try {
  const options = parseArgs(process.argv.slice(2));
  const files = await collectInputFiles(options.inputs, options.recursive);

  if (files.length === 0) {
    throw new Error("No image files found.");
  }

  const results: FileCompressionResult[] = [];

  for (const file of files) {
    const result = await compressFile(file, options);
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

/*
 * Keep this orchestration local to the CLI so package consumers can decide
 * their own storage model without inheriting Smartu's path conventions.
 */
async function compressFile(filePath: string, options: CliOptions): Promise<FileCompressionResult> {
  const buffer = await fs.readFile(filePath);
  const result = await compressImage(buffer, options);
  const target = resolveTargetPaths(filePath, result, options);

  if (shouldWritePrimary(filePath, target.primaryPath, result, options)) {
    await fs.mkdir(path.dirname(target.primaryPath), { recursive: true });
    await writeOutput(target.primaryPath, result.primary.buffer, options.replaceOriginal);
  }

  for (const [index, output] of result.alternatives.entries()) {
    const alternativePath = target.alternativePaths[index];
    if (alternativePath) {
      await fs.mkdir(path.dirname(alternativePath), { recursive: true });
      await writeOutput(alternativePath, output.buffer, false);
    }
  }

  return {
    ...result,
    sourcePath: filePath,
    primaryPath: target.primaryPath,
    alternativePaths: target.alternativePaths,
    visibleFormat: normalizeVisibleFormat(path.extname(filePath)),
  };
}

function resolveTargetPaths(
  sourcePath: string,
  result: CompressionResult,
  options: CliOptions,
): { readonly primaryPath: string; readonly alternativePaths: readonly string[] } {
  const source = path.parse(sourcePath);
  const outputDir = options.replaceOriginal ? source.dir : options.outputDir ?? path.join(source.dir, "smartu-output");
  const primaryPath = path.join(outputDir, `${source.name}.${result.primary.format}`);
  const alternativePaths = result.alternatives.map((output) =>
    path.join(outputDir, `${source.name}${output.suffix ?? ""}.${output.format}`),
  );

  return {
    primaryPath,
    alternativePaths,
  };
}

/*
 * The npm API stays buffer-only; filesystem side effects live in the CLI.
 * For --replace, write a temporary file first so a failed write does not
 * truncate the source image.
 */
async function writeOutput(filePath: string, buffer: Uint8Array, replaceOriginal: boolean): Promise<void> {
  if (!replaceOriginal) {
    await fs.writeFile(filePath, buffer);
    return;
  }

  const temporaryPath = `${filePath}.smartu-${process.pid}-${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, buffer);
  await fs.rename(temporaryPath, filePath);
}

/*
 * For --replace, skip writing when Smartu kept the source bytes; this avoids
 * touching file metadata when compression did not improve the image.
 */
function shouldWritePrimary(
  sourcePath: string,
  primaryPath: string,
  result: CompressionResult,
  options: CliOptions,
): boolean {
  if (!options.replaceOriginal) {
    return true;
  }

  if (path.resolve(sourcePath) !== path.resolve(primaryPath)) {
    return true;
  }

  return result.primary.compressed;
}

function parseArgs(args: readonly string[]): CliOptions {
  const program = new Command();

  program
    .name("smartu")
    .description("Compress image files with the Smartu strategy.")
    .argument("<inputs...>", "input files or directories")
    .option("-o, --out <dir>", "write output files to a directory")
    .option("--replace", "replace the original path only when the primary output is smaller", false)
    .option("--recursive", "recurse into input directories", false)
    .option("--format <formats>", "comma-separated output formats: auto,png,jpg,jpeg,webp", parseFormatList, ["auto"])
    .option("-q, --quality <quality>", "quality mode: auto, q1..q6, or a numeric adjustment (default: auto)", parseQuality)
    .option("--json", "print machine-readable results", false);

  program.parse(args, { from: "user" });

  const rawOptions = program.opts<{
    readonly out?: string;
    readonly replace: boolean;
    readonly recursive: boolean;
    readonly format: readonly CompressionFormat[];
    readonly quality?: { readonly qualityPreset?: QualityPreset; readonly qualityAdjustment?: number };
    readonly json: boolean;
  }>();
  const inputs = program.args;
  const quality = rawOptions.quality ?? {};

  return {
    inputs,
    outputDir: rawOptions.out,
    replaceOriginal: rawOptions.replace,
    recursive: rawOptions.recursive,
    formats: rawOptions.format,
    qualityPreset: quality.qualityPreset,
    qualityAdjustment: quality.qualityAdjustment,
    json: rawOptions.json,
  };
}

function parseFormatList(value: string): CompressionFormat[] {
  const formats: CompressionFormat[] = [];

  for (const part of value.split(",")) {
    const normalized = part.trim().toLowerCase();
    const format = normalized === "jpeg" ? "jpg" : normalized;

    if (!outputFormats.has(format as CompressionFormat)) {
      throw new InvalidArgumentError(`Invalid format: ${part}`);
    }

    if (!formats.includes(format as CompressionFormat)) {
      formats.push(format as CompressionFormat);
    }
  }

  if (formats.length === 0) {
    throw new InvalidArgumentError("At least one format is required.");
  }

  return formats;
}

function parseQuality(value: string): { readonly qualityPreset?: QualityPreset; readonly qualityAdjustment?: number } {
  const normalized = value.toLowerCase();

  if (normalized === "auto") {
    return {};
  }

  if (isQualityPreset(normalized)) {
    return {
      qualityPreset: normalized,
    };
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new InvalidArgumentError(`Invalid quality value: ${value}`);
  }

  return {
    qualityAdjustment: parsed,
  };
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
    visibleFormat: result.visibleFormat,
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

function normalizeVisibleFormat(extension: string): string | undefined {
  const normalized = extension.replace(/^\./, "").toLowerCase();
  if (normalized.length === 0) {
    return undefined;
  }

  return normalized === "jpeg" ? "jpg" : normalized;
}
