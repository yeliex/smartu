import { decode as decodeJpeg, encode as encodeJpeg } from "@jsquash/jpeg";
import { optimise as optimisePng } from "@jsquash/oxipng";
import { decode as decodePng } from "@jsquash/png";
import { decode as decodeWebp, encode as encodeWebp } from "@jsquash/webp";
import { type ImageFormat } from "./libs/format.ts";
import { type CompressionPlan, type ImageMetadata } from "./libs/strategy.ts";

export async function decodeBrowserImage(buffer: Uint8Array, format: ImageFormat): Promise<ImageData | undefined> {
  const source = toArrayBuffer(buffer);

  if (format === "jpg") {
    return decodeJpeg(source);
  }

  if (format === "png") {
    return decodePng(source);
  }

  if (format === "webp") {
    return decodeWebp(source);
  }

  return undefined;
}

export async function encodeBrowserCandidate(
  buffer: Uint8Array,
  metadata: ImageMetadata,
  imageData: ImageData | undefined,
  candidate: CompressionPlan["primary"],
): Promise<Uint8Array> {
  if (candidate.format === "gif") {
    return buffer;
  }

  if (!imageData) {
    throw new Error(`Cannot encode ${candidate.format} without decoded pixels.`);
  }

  if (candidate.format === "png") {
    /*
     * Source-byte optimization preserves useful PNG structure, while raw pixel
     * encoding can pick better filters for poorly encoded sources. Try both for
     * PNG inputs and keep the smaller result.
     */
    const options = {
      level: 4,
      interlace: false,
      optimiseAlpha: metadata.hasAlpha,
    };
    const rawPng = new Uint8Array(await optimisePng(imageData, options));

    if (metadata.realFormat !== "png") {
      return rawPng;
    }

    const sourcePng = new Uint8Array(await optimisePng(toArrayBuffer(buffer), options));
    return sourcePng.byteLength < rawPng.byteLength ? sourcePng : rawPng;
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

function toArrayBuffer(buffer: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy.buffer;
}
