import { promises as fs } from "node:fs";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import {
  createCompressionPlan,
  estimateJpegQuality,
  extensionForFormat,
  isPalettePng,
  type CompressionOptions,
  type CompressionOutput,
  type CompressionPlan,
  type CompressionResult,
  type ImageFormat,
  type ImageMetadata,
  shouldUsePng8,
} from "./index.js";

export {
  clampQuality,
  createCompressionPlan,
  detectImageFormat,
  estimateJpegQuality,
  extensionForFormat,
  getQualityAdjustment,
  isPalettePng,
  selectJpegBaseQuality,
  selectJpegCompressionQuality,
  selectPngQuality,
  shouldUsePng8,
  type CompressionOptions,
  type CompressionPlan,
  type CompressionResult,
  type ImageFormat,
  type ImageMetadata,
  type QualityPreset,
} from "./index.js";

export interface CompressFileOptions extends CompressionOptions {
  readonly outputDir?: string;
  readonly replaceOriginal?: boolean;
}

export interface FileCompressionResult extends CompressionResult {
  readonly sourcePath: string;
  readonly primaryPath: string;
  readonly alternativePaths: readonly string[];
}

const supportedFormats = new Set<ImageFormat>(["png", "jpg", "gif", "webp"]);

export async function analyzeImageFile(filePath: string): Promise<ImageMetadata> {
  const buffer = await fs.readFile(filePath);
  return analyzeImageBuffer(buffer, {
    path: filePath,
    visibleFormat: normalizeVisibleFormat(path.extname(filePath)),
  });
}

export async function analyzeImageBuffer(
  buffer: Uint8Array,
  input: { readonly path?: string; readonly visibleFormat?: string } = {},
): Promise<ImageMetadata> {
  const metadata = await sharp(buffer, { animated: true }).metadata();
  const realFormat = normalizeSharpFormat(metadata.format);

  if (!realFormat || !supportedFormats.has(realFormat)) {
    throw new Error(`Unsupported image format: ${metadata.format ?? "unknown"}`);
  }

  const width = metadata.width;
  const height = metadata.pageHeight ?? metadata.height;

  if (typeof width !== "number" || typeof height !== "number") {
    throw new Error("Unable to read image dimensions.");
  }

  const stats = await readPixelStats(buffer, realFormat, metadata);
  const jpegQuality = realFormat === "jpg" ? estimateJpegQuality(buffer) : 0;

  return {
    ...input,
    realFormat,
    width,
    height,
    area: width * height,
    size: buffer.byteLength,
    colorCount: stats.colorCount,
    hasAlpha: stats.hasAlpha,
    isPng8: realFormat === "png" && isPalettePng(buffer),
    jpegQuality,
  };
}

export async function compressImageBuffer(
  buffer: Uint8Array,
  options: CompressionOptions = {},
): Promise<CompressionResult> {
  const metadata = await analyzeImageBuffer(buffer);
  const plan = createCompressionPlan(metadata, options);
  return compressWithPlan(buffer, metadata, plan);
}

export async function compressImageFile(
  filePath: string,
  options: CompressFileOptions = {},
): Promise<FileCompressionResult> {
  const buffer = await fs.readFile(filePath);
  const metadata = await analyzeImageBuffer(buffer, {
    path: filePath,
    visibleFormat: normalizeVisibleFormat(path.extname(filePath)),
  });
  const plan = createCompressionPlan(metadata, options);
  const result = await compressWithPlan(buffer, metadata, plan);
  const target = resolveTargetPaths(filePath, result, options);

  if (shouldWritePrimary(filePath, target.primaryPath, result, options)) {
    await fs.mkdir(path.dirname(target.primaryPath), { recursive: true });
    await writeOutput(target.primaryPath, result.primary.buffer, options.replaceOriginal === true);
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
  };
}

async function compressWithPlan(
  buffer: Uint8Array,
  metadata: ImageMetadata,
  plan: CompressionPlan,
): Promise<CompressionResult> {
  const primaryCandidate = await encodeCandidate(buffer, metadata, plan.primary);
  const primary = choosePrimary(buffer, primaryCandidate, plan.primary.reason, metadata.realFormat);
  const alternatives: CompressionOutput[] = [];

  if (plan.converted) {
    const converted = await encodeCandidate(buffer, metadata, plan.converted);
    if (converted.byteLength < primary.size) {
      alternatives.push({
        kind: "converted",
        format: plan.converted.format,
        buffer: converted,
        size: converted.byteLength,
        compressed: true,
        suffix: plan.converted.suffix,
        reason: plan.converted.reason,
      });
    }
  }

  if (plan.webp) {
    const webp = await encodeCandidate(buffer, metadata, plan.webp);
    if (webp.byteLength < metadata.size) {
      alternatives.push({
        kind: "webp",
        format: "webp",
        buffer: webp,
        size: webp.byteLength,
        compressed: true,
        suffix: plan.webp.suffix,
        reason: plan.webp.reason,
      });
    }
  }

  return {
    metadata,
    plan,
    primary,
    alternatives,
  };
}

async function encodeCandidate(
  buffer: Uint8Array,
  metadata: ImageMetadata,
  candidate: CompressionPlan["primary"],
): Promise<Uint8Array> {
  const image = sharp(buffer, { animated: metadata.realFormat === "gif" });

  if (candidate.format === "png") {
    const palette = metadata.realFormat === "jpg" ? metadata.colorCount < 256 : shouldUsePng8(metadata);
    return image
      .png({
        compressionLevel: 9,
        effort: 10,
        palette,
        quality: candidate.maxQuality ?? 90,
        colours: 256,
        dither: 1,
      })
      .toBuffer();
  }

  if (candidate.format === "jpg") {
    return image
      .flatten({ background: "#ffffff" })
      .jpeg({
        quality: candidate.quality ?? 75,
        progressive: true,
        mozjpeg: true,
      })
      .toBuffer();
  }

  if (candidate.format === "gif") {
    return image
      .gif({
        effort: 10,
      })
      .toBuffer();
  }

  return image
    .webp({
      quality: candidate.quality ?? 80,
      effort: 6,
    })
    .toBuffer();
}

function choosePrimary(
  original: Uint8Array,
  candidateBuffer: Uint8Array,
  reason: string,
  format: ImageFormat,
): CompressionOutput {
  if (candidateBuffer.byteLength < original.byteLength) {
    return {
      kind: "primary",
      format,
      buffer: candidateBuffer,
      size: candidateBuffer.byteLength,
      compressed: true,
      reason,
    };
  }

  return {
    kind: "primary",
    format,
    buffer: original,
    size: original.byteLength,
    compressed: false,
    reason: "source-smaller-or-equal",
  };
}

function resolveTargetPaths(
  sourcePath: string,
  result: CompressionResult,
  options: CompressFileOptions,
): { readonly primaryPath: string; readonly alternativePaths: readonly string[] } {
  const source = path.parse(sourcePath);
  const outputDir = options.replaceOriginal === true ? source.dir : options.outputDir ?? path.join(source.dir, "smartu-output");
  const primaryPath = path.join(outputDir, `${source.name}.${extensionForFormat(result.metadata.realFormat)}`);
  const alternativePaths = result.alternatives.map((output) =>
    path.join(outputDir, `${source.name}${output.suffix ?? ""}.${extensionForFormat(output.format)}`),
  );

  return {
    primaryPath,
    alternativePaths,
  };
}

async function writeOutput(filePath: string, buffer: Uint8Array, replaceOriginal: boolean): Promise<void> {
  if (!replaceOriginal) {
    await fs.writeFile(filePath, buffer);
    return;
  }

  const temporaryPath = `${filePath}.smartu-${process.pid}-${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, buffer);
  await fs.rename(temporaryPath, filePath);
}

function shouldWritePrimary(
  sourcePath: string,
  primaryPath: string,
  result: CompressionResult,
  options: CompressFileOptions,
): boolean {
  if (options.replaceOriginal !== true) {
    return true;
  }

  if (path.resolve(sourcePath) !== path.resolve(primaryPath)) {
    return true;
  }

  return result.primary.compressed;
}

async function readPixelStats(
  buffer: Uint8Array,
  format: ImageFormat,
  metadata: Metadata,
): Promise<{ readonly colorCount: number; readonly hasAlpha: boolean }> {
  const raw = await sharp(buffer, { animated: false }).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  const colors = new Set<string>();
  let hasAlpha = metadata.hasAlpha === true && format !== "jpg";
  const channels = raw.info.channels;

  for (let offset = 0; offset + channels - 1 < raw.data.length; offset += channels) {
    const red = raw.data[offset];
    const green = raw.data[offset + 1];
    const blue = raw.data[offset + 2];
    const alpha = raw.data[offset + 3];

    if (alpha !== undefined && alpha < 255) {
      hasAlpha = true;
    }

    colors.add(`${red},${green},${blue},${alpha ?? 255}`);
    if (colors.size > 30_000) {
      return {
        colorCount: colors.size,
        hasAlpha,
      };
    }
  }

  return {
    colorCount: colors.size,
    hasAlpha,
  };
}

function normalizeSharpFormat(format: string | undefined): ImageFormat | undefined {
  if (format === "jpeg") {
    return "jpg";
  }

  if (format === "png" || format === "gif" || format === "webp") {
    return format;
  }

  return undefined;
}

function normalizeVisibleFormat(extension: string): string | undefined {
  const normalized = extension.replace(/^\./, "").toLowerCase();
  if (normalized.length === 0) {
    return undefined;
  }

  return normalized === "jpeg" ? "jpg" : normalized;
}
