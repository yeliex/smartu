import sharp, { type Metadata } from "sharp";
import { isPalettePng, type ImageFormat } from "./libs/format.js";
import { estimateJpegQuality } from "./libs/quality.js";
import {
  createCompressionPlan,
  type CompressionOptions,
  type CompressionOutput,
  type CompressionPlan,
  type CompressionResult,
  type ImageMetadata,
  shouldUsePng8,
} from "./libs/strategy.js";

export {
  detectImageFormat,
  isPalettePng,
  type ImageFormat,
} from "./libs/format.js";
export {
  clampQuality,
  estimateJpegQuality,
  getQualityAdjustment,
  selectJpegBaseQuality,
  selectJpegCompressionQuality,
  selectPngQuality,
  type QualityOptions,
  type QualityPreset,
} from "./libs/quality.js";
export {
  createCompressionPlan,
  shouldUsePng8,
  type CompressionFormat,
  type CompressionOptions,
  type CompressionOutput,
  type CompressionPlan,
  type CompressionResult,
  type ImageMetadata,
  type StrategyCandidate,
} from "./libs/strategy.js";

/*
 * Node uses Sharp for structural metadata and pixel access, but still feeds
 * the raw bytes into format-specific checks such as PNG palette detection and
 * JPEG quality estimation.
 */
export async function analyzeImage(buffer: Uint8Array): Promise<ImageMetadata> {
  const metadata = await sharp(buffer, { animated: true }).metadata();
  const realFormat = normalizeSharpFormat(metadata.format);

  if (!realFormat) {
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

/*
 * Keep the public Node API buffer-only. File paths, output naming, and
 * replacement semantics belong to CLI or application code.
 */
export async function compressImage(
  buffer: Uint8Array,
  options: CompressionOptions = {},
): Promise<CompressionResult> {
  const metadata = await analyzeImage(buffer);
  const plan = createCompressionPlan(metadata, options);
  return compressWithPlan(buffer, metadata, plan);
}

/*
 * The plan only predicts useful candidates; byte savings are known after
 * encoding. Keep the source when primary output is not smaller, and expose
 * conversion/WebP alternatives only when their encoded size wins.
 */
async function compressWithPlan(
  buffer: Uint8Array,
  metadata: ImageMetadata,
  plan: CompressionPlan,
): Promise<CompressionResult> {
  const primaryCandidate = await encodeCandidate(buffer, metadata, plan.primary);
  const primary = choosePrimary(buffer, primaryCandidate, plan.primary.reason, plan.primary.format, metadata.realFormat);
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
  sourceFormat: ImageFormat,
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

  if (format !== sourceFormat) {
    return {
      kind: "primary",
      format,
      buffer: candidateBuffer,
      size: candidateBuffer.byteLength,
      compressed: false,
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

/*
 * Color count is only used for threshold decisions. Stop once the highest
 * strategy threshold is exceeded so large photos do not spend time collecting
 * an exact set that will not change the selected branch.
 */
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
