import {
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
  type CompressionOutput,
  type CompressionPlan,
  type CompressionResult,
  type ImageFormat,
  type ImageMetadata,
  type QualityPreset,
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
};

export interface BrowserCompressionResult extends CompressionResult {
  readonly primaryBlob: Blob;
  readonly alternativeBlobs: readonly Blob[];
}

export async function analyzeImageInBrowser(input: Blob | Uint8Array): Promise<ImageMetadata> {
  const buffer = await toUint8Array(input);
  const realFormat = detectImageFormat(buffer);

  if (!realFormat) {
    throw new Error("Unsupported image format.");
  }

  const blob = input instanceof Blob ? input : blobFromUint8Array(buffer, realFormat);
  const bitmap = await createImageBitmap(blob);
  const pixels = readPixels(bitmap);
  const stats = readPixelStats(pixels.data);
  bitmap.close();

  return {
    realFormat,
    width: pixels.width,
    height: pixels.height,
    area: pixels.width * pixels.height,
    size: buffer.byteLength,
    colorCount: stats.colorCount,
    hasAlpha: realFormat !== "jpg" && stats.hasAlpha,
    isPng8: realFormat === "png" && isPalettePng(buffer),
    jpegQuality: realFormat === "jpg" ? estimateJpegQuality(buffer) : 0,
  };
}

export async function compressImageInBrowser(
  input: Blob | Uint8Array,
  options: CompressionOptions = {},
): Promise<BrowserCompressionResult> {
  const buffer = await toUint8Array(input);
  const metadata = await analyzeImageInBrowser(buffer);
  const plan = createCompressionPlan(metadata, options);
  const primaryCandidate = await encodeBrowserCandidate(buffer, metadata, plan.primary);
  const primary = choosePrimary(buffer, primaryCandidate, plan.primary.reason, metadata.realFormat);
  const alternatives: CompressionOutput[] = [];

  if (plan.converted) {
    const converted = await encodeBrowserCandidate(buffer, metadata, plan.converted);
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
    const webp = await encodeBrowserCandidate(buffer, metadata, plan.webp);
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

  return {
    ...result,
    primaryBlob: blobFromUint8Array(primary.buffer, primary.format),
    alternativeBlobs: alternatives.map((output) => blobFromUint8Array(output.buffer, output.format)),
  };
}

export function outputFileName(sourceName: string, output: CompressionOutput): string {
  const dotIndex = sourceName.lastIndexOf(".");
  const basename = dotIndex >= 0 ? sourceName.slice(0, dotIndex) : sourceName;
  return `${basename}${output.suffix ?? ""}.${extensionForFormat(output.format)}`;
}

async function encodeBrowserCandidate(
  buffer: Uint8Array,
  metadata: ImageMetadata,
  candidate: CompressionPlan["primary"],
): Promise<Uint8Array> {
  if (candidate.format === "gif") {
    return buffer;
  }

  const blob = blobFromUint8Array(buffer, metadata.realFormat);
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");

  if (!context) {
    bitmap.close();
    throw new Error("Canvas 2D context is not available.");
  }

  if (candidate.format === "jpg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  const encoded = await canvas.convertToBlob({
    type: mimeForFormat(candidate.format),
    quality: candidate.quality ? candidate.quality / 100 : undefined,
  });

  return new Uint8Array(await encoded.arrayBuffer());
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

function readPixels(bitmap: ImageBitmap): ImageData {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("Canvas 2D context is not available.");
  }

  context.drawImage(bitmap, 0, 0);
  return context.getImageData(0, 0, bitmap.width, bitmap.height);
}

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
