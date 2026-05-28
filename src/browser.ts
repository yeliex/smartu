import {
  detectImageFormat,
  isPalettePng,
  type ImageFormat,
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

  if (realFormat === "gif") {
    const gif = readGifMetadata(buffer);
    return {
      metadata: {
        realFormat,
        width: gif.width,
        height: gif.height,
        area: gif.width * gif.height,
        size: buffer.byteLength,
        colorCount: gif.colorCount,
        hasAlpha: gif.hasAlpha,
        isPng8: false,
        jpegQuality: 0,
      },
    };
  }

  const imageData = await decodeBrowserImage(buffer, realFormat);

  if (!imageData) {
    throw new Error(`Unsupported image format: ${realFormat}`);
  }

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

function readGifMetadata(buffer: Uint8Array): {
  readonly width: number;
  readonly height: number;
  readonly colorCount: number;
  readonly hasAlpha: boolean;
} {
  if (buffer.byteLength < 10) {
    throw new Error("Unable to read GIF dimensions.");
  }

  const width = (buffer[6] ?? 0) + ((buffer[7] ?? 0) << 8);
  const height = (buffer[8] ?? 0) + ((buffer[9] ?? 0) << 8);
  const packed = buffer[10] ?? 0;
  const colorCount = packed & 0x80 ? 2 ** ((packed & 0x07) + 1) : 0;

  return {
    width,
    height,
    colorCount,
    hasAlpha: hasGifTransparency(buffer),
  };
}

function hasGifTransparency(buffer: Uint8Array): boolean {
  for (let offset = 0; offset + 7 < buffer.length; offset += 1) {
    if (
      buffer[offset] === 0x21 &&
      buffer[offset + 1] === 0xf9 &&
      buffer[offset + 2] === 0x04 &&
      ((buffer[offset + 3] ?? 0) & 0x01) === 0x01
    ) {
      return true;
    }
  }

  return false;
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
