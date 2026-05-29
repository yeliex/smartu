import { encode as encodeAvif } from "@jsquash/avif";
import { decode as decodeJpeg, encode as encodeJpeg } from "@jsquash/jpeg";
import { optimise as optimisePng } from "@jsquash/oxipng";
import { decode as decodePng } from "@jsquash/png";
import { encode as encodeWebp } from "@jsquash/webp";
import { type SourceImageFormat } from "./libs/format.ts";
import {
  acceptsPngQuantization,
  pngOptimizationLevel,
  quantizePngPalette,
  shouldTryPngQuantization,
  type RgbaImageData,
} from "./libs/png-quantize.ts";
import { type CompressionPlan, type ImageMetadata } from "./libs/strategy.ts";

export async function decodeBrowserImage(buffer: Uint8Array, format: SourceImageFormat): Promise<ImageData> {
  const source = toArrayBuffer(buffer);

  if (format === "jpg") {
    return decodeJpeg(source);
  }

  if (format === "png") {
    return decodePng(source);
  }

  throw new Error(`Unsupported image format: ${format}`);
}

export async function encodeBrowserCandidate(
  _buffer: Uint8Array,
  metadata: ImageMetadata,
  imageData: ImageData | undefined,
  candidate: CompressionPlan["primary"],
): Promise<Uint8Array> {
  if (!imageData) {
    throw new Error(`Cannot encode ${candidate.format} without decoded pixels.`);
  }

  if (candidate.format === "png") {
    if (candidate.reason === "png8-palette") {
      const quantized = await quantizePngPalette(imageData);
      return new Uint8Array(
        await optimisePng(toBrowserImageData(quantized), {
          level: pngOptimizationLevel,
          interlace: false,
          optimiseAlpha: metadata.hasAlpha,
        }),
      );
    }

    const lossless = new Uint8Array(
      await optimisePng(toArrayBuffer(_buffer), {
        level: pngOptimizationLevel,
        interlace: false,
        optimiseAlpha: metadata.hasAlpha,
      }),
    );

    if (!shouldTryPngQuantization(metadata)) {
      return lossless;
    }

    const quantizedImage = await quantizePngPalette(imageData);
    const quantized = new Uint8Array(
      await optimisePng(toBrowserImageData(quantizedImage), {
        level: pngOptimizationLevel,
        interlace: false,
        optimiseAlpha: metadata.hasAlpha,
      }),
    );

    if (
      quantized.byteLength < lossless.byteLength &&
      acceptsPngQuantization(imageData, quantizedImage, candidate.minQuality ?? 0)
    ) {
      return quantized;
    }

    return lossless;
  }

  if (candidate.format === "jpg") {
    return new Uint8Array(
      await encodeJpeg(flattenToWhite(imageData), {
        quality: candidate.quality ?? 75,
        progressive: true,
        optimize_coding: true,
      }),
    );
  }

  if (candidate.format === "avif") {
    return new Uint8Array(
      await encodeAvif(imageData, {
        quality: candidate.quality ?? 50,
        speed: 6,
      }),
    );
  }

  return new Uint8Array(
    await encodeWebp(imageData, {
      quality: candidate.quality ?? 80,
      method: 6,
      alpha_quality: 100,
    }),
  );
}

function flattenToWhite(imageData: ImageData): ImageData {
  const data = imageData.data;
  let hasAlpha = false;

  for (let offset = 3; offset < data.length; offset += 4) {
    if ((data[offset] ?? 255) < 255) {
      hasAlpha = true;
      break;
    }
  }

  if (!hasAlpha) {
    return imageData;
  }

  const flattened = new Uint8ClampedArray(data.length);
  for (let offset = 0; offset + 3 < data.length; offset += 4) {
    const alpha = (data[offset + 3] ?? 255) / 255;
    flattened[offset] = Math.round((data[offset] ?? 0) * alpha + 255 * (1 - alpha));
    flattened[offset + 1] = Math.round((data[offset + 1] ?? 0) * alpha + 255 * (1 - alpha));
    flattened[offset + 2] = Math.round((data[offset + 2] ?? 0) * alpha + 255 * (1 - alpha));
    flattened[offset + 3] = 255;
  }

  return new ImageData(flattened, imageData.width, imageData.height);
}

function toBrowserImageData(imageData: RgbaImageData): ImageData {
  const data = new Uint8ClampedArray(imageData.data.length);
  data.set(imageData.data);
  return new ImageData(data, imageData.width, imageData.height);
}

function toArrayBuffer(buffer: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy.buffer;
}
