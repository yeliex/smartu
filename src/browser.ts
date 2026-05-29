import {
  detectImageFormat,
  isPalettePng,
  type ImageFormat,
  type SourceImageFormat,
} from "./libs/format.ts";
import { estimateJpegQuality } from "./libs/quality.ts";
import {
  createCompressionPlan,
  type CompressionOptions,
  type CompressionOutput,
  type CompressionResult,
  type ImageMetadata,
} from "./libs/strategy.ts";
import { decodeBrowserImage, encodeBrowserCandidate } from "./browser-codecs.ts";

export {
  detectImageFormat,
  isPalettePng,
  type ImageFormat,
  type SourceImageFormat,
} from "./libs/format.ts";
export {
  clampQuality,
  estimateJpegQuality,
  getQualityAdjustment,
  selectJpegBaseQuality,
  selectJpegCompressionQuality,
  selectPngQuality,
  type QualityOptions,
  type QualityPreset,
} from "./libs/quality.ts";
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
} from "./libs/strategy.ts";

interface BrowserCompressionResult extends CompressionResult {
  readonly primaryBlob: Blob;
  readonly alternativeBlobs: readonly Blob[];
}

export async function analyzeImage(input: Blob | Uint8Array): Promise<ImageMetadata> {
  const buffer = await toUint8Array(input);
  const decoded = await analyzeDecodedImage(buffer);
  return decoded.metadata;
}

interface DecodedBrowserImage {
  readonly metadata: ImageMetadata;
  readonly imageData?: ImageData;
}

async function analyzeDecodedImage(buffer: Uint8Array): Promise<DecodedBrowserImage> {
  const realFormat = detectImageFormat(buffer);

  if (!realFormat) {
    throw new Error("Unsupported image format.");
  }

  if (!isSupportedSourceFormat(realFormat)) {
    throw new Error(`Unsupported image format: ${realFormat}`);
  }

  const imageData = await decodeBrowserImage(buffer, realFormat);

  const stats = readPixelStats(imageData.data);

  return {
    metadata: {
      realFormat,
      width: imageData.width,
      height: imageData.height,
      area: imageData.width * imageData.height,
      size: buffer.byteLength,
      colorCount: stats.colorCount,
      hasAlpha: realFormat !== "jpg" && stats.hasAlpha,
      isPng8: realFormat === "png" && isPalettePng(buffer),
      jpegQuality: realFormat === "jpg" ? estimateJpegQuality(buffer) : 0,
    },
    imageData,
  };
}

/*
 * The browser API accepts Blob for UI code and Uint8Array for lower-level
 * callers, then normalizes once so planning and candidate encoding share the
 * same bytes.
 */
export async function compressImage(
  input: Blob | Uint8Array,
  options: CompressionOptions = {},
): Promise<BrowserCompressionResult> {
  const buffer = await toUint8Array(input);
  const { metadata, imageData } = await analyzeDecodedImage(buffer);
  const plan = createCompressionPlan(metadata, options);
  const primaryCandidate = await encodeBrowserCandidate(buffer, metadata, imageData, plan.primary);
  const primary = choosePrimary(buffer, primaryCandidate, plan.primary.reason, plan.primary.format, metadata.realFormat);
  const alternatives: CompressionOutput[] = [];

  if (plan.converted) {
    const converted = await encodeBrowserCandidate(buffer, metadata, imageData, plan.converted);
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
    const webp = await encodeBrowserCandidate(buffer, metadata, imageData, plan.webp);
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

  if (plan.avif) {
    const avif = await encodeBrowserCandidate(buffer, metadata, imageData, plan.avif);
    if (avif.byteLength < metadata.size) {
      alternatives.push({
        kind: "avif",
        format: "avif",
        buffer: avif,
        size: avif.byteLength,
        compressed: true,
        suffix: plan.avif.suffix,
        reason: plan.avif.reason,
      });
    }
  }

  const result: CompressionResult = {
    metadata,
    plan,
    primary,
    alternatives,
  };

  /*
   * Return Blob handles beside the shared byte-oriented result so browser UIs
   * can create object URLs without duplicating format-to-MIME handling.
   */
  return {
    ...result,
    primaryBlob: blobFromUint8Array(primary.buffer, primary.format),
    alternativeBlobs: alternatives.map((output) => blobFromUint8Array(output.buffer, output.format)),
  };
}

function isSupportedSourceFormat(format: ImageFormat): format is SourceImageFormat {
  return format === "png" || format === "jpg";
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
 * Match the Node cutoff: after the highest strategy threshold is exceeded, an
 * exact color count would not change branch selection.
 */
function readPixelStats(data: Uint8ClampedArray): { readonly colorCount: number; readonly hasAlpha: boolean } {
  const colors = new Set<string>();
  let hasAlpha = false;

  for (let offset = 0; offset + 3 < data.length; offset += 4) {
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const alpha = data[offset + 3] ?? 255;

    if (alpha < 255) {
      hasAlpha = true;
    }

    colors.add(`${red},${green},${blue},${alpha}`);
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

async function toUint8Array(input: Blob | Uint8Array): Promise<Uint8Array> {
  if (input instanceof Uint8Array) {
    return input;
  }

  return new Uint8Array(await input.arrayBuffer());
}

function mimeForFormat(format: ImageFormat): string {
  if (format === "jpg") {
    return "image/jpeg";
  }

  return `image/${format}`;
}

function blobFromUint8Array(buffer: Uint8Array, format: ImageFormat): Blob {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return new Blob([copy], { type: mimeForFormat(format) });
}
