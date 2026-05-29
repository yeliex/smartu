import encodeAvif, { init as initAvifEncode } from "@jsquash/avif/encode.js";
import decodeJpeg, { init as initJpegDecode } from "@jsquash/jpeg/decode.js";
import encodeJpeg, { init as initJpegEncode } from "@jsquash/jpeg/encode.js";
import optimisePng, { init as initOxipng } from "@jsquash/oxipng/optimise.js";
import { decode as decodePng, init as initPngDecode } from "@jsquash/png/decode.js";
import encodeWebp, { init as initWebpEncode } from "@jsquash/webp/encode.js";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { simd } from "wasm-feature-detect";
import { detectImageFormat, isPalettePng, type ImageFormat, type SourceImageFormat } from "./libs/format.ts";
import {
  acceptsPngQuantization,
  pngOptimizationLevel,
  quantizePngPalette,
  shouldTryPngQuantization,
  type RgbaImageData,
} from "./libs/png-quantize.ts";
import { estimateJpegQuality } from "./libs/quality.ts";
import {
  createCompressionPlan,
  type CompressionOptions,
  type CompressionOutput,
  type CompressionPlan,
  type CompressionResult,
  type ImageMetadata,
} from "./libs/strategy.ts";

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

interface DecodedNodeImage {
  readonly metadata: ImageMetadata;
  readonly imageData: RgbaImageData;
}

export async function analyzeImage(buffer: Uint8Array): Promise<ImageMetadata> {
  const decoded = await analyzeDecodedImage(buffer);
  return decoded.metadata;
}

/*
 * Keep the public Node API buffer-only. File paths, output naming, and
 * replacement semantics belong to CLI or application code.
 */
export async function compressImage(
  buffer: Uint8Array,
  options: CompressionOptions = {},
): Promise<CompressionResult> {
  const { metadata, imageData } = await analyzeDecodedImage(buffer);
  const plan = createCompressionPlan(metadata, options);
  return compressWithPlan(buffer, metadata, imageData, plan);
}

async function analyzeDecodedImage(buffer: Uint8Array): Promise<DecodedNodeImage> {
  const realFormat = detectImageFormat(buffer);

  if (!realFormat) {
    throw new Error("Unsupported image format.");
  }

  if (!isSupportedSourceFormat(realFormat)) {
    throw new Error(`Unsupported image format: ${realFormat}`);
  }

  const imageData = await decodeNodeImage(buffer, realFormat);
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
 * The plan only predicts useful candidates; byte savings are known after
 * encoding. Keep the source when primary output is not smaller, and expose
 * conversion/WebP/AVIF alternatives only when their encoded size wins.
 */
async function compressWithPlan(
  buffer: Uint8Array,
  metadata: ImageMetadata,
  imageData: RgbaImageData,
  plan: CompressionPlan,
): Promise<CompressionResult> {
  const primaryCandidate = await encodeCandidate(buffer, metadata, imageData, plan.primary);
  const primary = choosePrimary(buffer, primaryCandidate, plan.primary.reason, plan.primary.format, metadata.realFormat);
  const alternatives: CompressionOutput[] = [];

  if (plan.converted) {
    const converted = await encodeCandidate(buffer, metadata, imageData, plan.converted);
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
    const webp = await encodeCandidate(buffer, metadata, imageData, plan.webp);
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
    const avif = await encodeCandidate(buffer, metadata, imageData, plan.avif);
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
  imageData: RgbaImageData,
  candidate: CompressionPlan["primary"],
): Promise<Uint8Array> {
  if (candidate.format === "png") {
    if (candidate.reason === "png8-palette") {
      const quantized = await quantizePngPalette(imageData);
      return optimiseRawPng(quantized, metadata.hasAlpha);
    }

    const lossless = await optimiseEncodedPng(buffer, metadata.hasAlpha);

    if (!shouldTryPngQuantization(metadata)) {
      return lossless;
    }

    const quantizedImage = await quantizePngPalette(imageData);
    const quantized = await optimiseRawPng(quantizedImage, metadata.hasAlpha);

    if (
      quantized.byteLength < lossless.byteLength &&
      acceptsPngQuantization(imageData, quantizedImage, candidate.minQuality ?? 0)
    ) {
      return quantized;
    }

    return lossless;
  }

  if (candidate.format === "jpg") {
    await initNodeJpegEncode();
    return new Uint8Array(
      await encodeJpeg(toImageDataLike(flattenToWhite(imageData)), {
        quality: candidate.quality ?? 75,
        progressive: true,
        optimize_coding: true,
      }),
    );
  }

  if (candidate.format === "avif") {
    await initNodeAvifEncode();
    return new Uint8Array(
      await encodeAvif(toImageDataLike(imageData), {
        quality: candidate.quality ?? 80,
        speed: 6,
      }),
    );
  }

  await initNodeWebpEncode();
  return new Uint8Array(
    await encodeWebp(toImageDataLike(imageData), {
      quality: candidate.quality ?? 80,
      method: 6,
      alpha_quality: 100,
    }),
  );
}

let pngDecodeReady: ReturnType<typeof initPngDecode> | undefined;
let jpegDecodeReady: ReturnType<typeof initJpegDecode> | undefined;
let jpegEncodeReady: ReturnType<typeof initJpegEncode> | undefined;
let webpEncodeReady: ReturnType<typeof initWebpEncode> | undefined;
let avifEncodeReady: ReturnType<typeof initAvifEncode> | undefined;
let oxipngReady: ReturnType<typeof initOxipng> | undefined;

async function decodeNodeImage(buffer: Uint8Array, format: SourceImageFormat): Promise<RgbaImageData> {
  if (format === "png") {
    await initNodePngDecode();
    return normalizeImageData(await decodePng(toArrayBuffer(buffer)));
  }

  await initNodeJpegDecode();
  return normalizeImageData(await decodeJpeg(toArrayBuffer(buffer)));
}

async function initNodePngDecode(): ReturnType<typeof initPngDecode> {
  if (!pngDecodeReady) {
    pngDecodeReady = initPngDecode(await readPackageFile("@jsquash/png", "codec/pkg/squoosh_png_bg.wasm"));
  }

  return pngDecodeReady;
}

async function initNodeJpegDecode(): ReturnType<typeof initJpegDecode> {
  if (!jpegDecodeReady) {
    jpegDecodeReady = initJpegDecode({
      wasmBinary: await readPackageArrayBuffer("@jsquash/jpeg", "codec/dec/mozjpeg_dec.wasm"),
    });
  }

  return jpegDecodeReady;
}

async function initNodeJpegEncode(): ReturnType<typeof initJpegEncode> {
  if (!jpegEncodeReady) {
    jpegEncodeReady = initJpegEncode({
      wasmBinary: await readPackageArrayBuffer("@jsquash/jpeg", "codec/enc/mozjpeg_enc.wasm"),
    });
  }

  return jpegEncodeReady;
}

async function initNodeWebpEncode(): ReturnType<typeof initWebpEncode> {
  if (!webpEncodeReady) {
    webpEncodeReady = initWebpEncode({
      wasmBinary: await readPackageArrayBuffer(
        "@jsquash/webp",
        (await simd()) ? "codec/enc/webp_enc_simd.wasm" : "codec/enc/webp_enc.wasm",
      ),
    });
  }

  return webpEncodeReady;
}

async function initNodeAvifEncode(): ReturnType<typeof initAvifEncode> {
  if (!avifEncodeReady) {
    avifEncodeReady = initAvifEncode({
      wasmBinary: await readPackageArrayBuffer("@jsquash/avif", "codec/enc/avif_enc.wasm"),
    });
  }

  return avifEncodeReady;
}

async function initNodeOxipng(): ReturnType<typeof initOxipng> {
  if (!oxipngReady) {
    oxipngReady = initOxipng(await readPackageFile("@jsquash/oxipng", "codec/pkg/squoosh_oxipng_bg.wasm"));
  }

  return oxipngReady;
}

async function optimiseEncodedPng(buffer: Uint8Array, optimiseAlpha: boolean): Promise<Uint8Array> {
  await initNodeOxipng();
  return new Uint8Array(
    await optimisePng(toArrayBuffer(buffer), {
      level: pngOptimizationLevel,
      interlace: false,
      optimiseAlpha,
    }),
  );
}

async function optimiseRawPng(imageData: RgbaImageData, optimiseAlpha: boolean): Promise<Uint8Array> {
  const oxipng = await initNodeOxipng();
  return new Uint8Array(
    oxipng.optimise_raw(imageData.data, imageData.width, imageData.height, pngOptimizationLevel, false, optimiseAlpha),
  );
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

function flattenToWhite(imageData: RgbaImageData): RgbaImageData {
  let hasAlpha = false;

  for (let offset = 3; offset < imageData.data.length; offset += 4) {
    if ((imageData.data[offset] ?? 255) < 255) {
      hasAlpha = true;
      break;
    }
  }

  if (!hasAlpha) {
    return imageData;
  }

  const flattened = new Uint8ClampedArray(imageData.data.length);
  for (let offset = 0; offset + 3 < imageData.data.length; offset += 4) {
    const alpha = (imageData.data[offset + 3] ?? 255) / 255;
    flattened[offset] = Math.round((imageData.data[offset] ?? 0) * alpha + 255 * (1 - alpha));
    flattened[offset + 1] = Math.round((imageData.data[offset + 1] ?? 0) * alpha + 255 * (1 - alpha));
    flattened[offset + 2] = Math.round((imageData.data[offset + 2] ?? 0) * alpha + 255 * (1 - alpha));
    flattened[offset + 3] = 255;
  }

  return {
    data: flattened,
    width: imageData.width,
    height: imageData.height,
  };
}

function normalizeImageData(imageData: ImageData): RgbaImageData {
  const data = new Uint8ClampedArray(imageData.data.length);
  data.set(imageData.data);

  return {
    data,
    width: imageData.width,
    height: imageData.height,
  };
}

function toImageDataLike(imageData: RgbaImageData): ImageData {
  const data = new Uint8ClampedArray(imageData.data.length);
  data.set(imageData.data);

  return {
    data,
    width: imageData.width,
    height: imageData.height,
    colorSpace: "srgb",
  };
}

function toArrayBuffer(buffer: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy.buffer;
}

async function readPackageFile(packageName: string, ...parts: readonly string[]): Promise<Uint8Array> {
  return fs.readFile(packagePath(packageName, ...parts));
}

async function readPackageArrayBuffer(packageName: string, ...parts: readonly string[]): Promise<ArrayBuffer> {
  return toArrayBuffer(await readPackageFile(packageName, ...parts));
}

function packagePath(packageName: string, ...parts: readonly string[]): string {
  const require = createRequire(import.meta.url);
  return path.join(path.dirname(require.resolve(`${packageName}/package.json`)), ...parts);
}
