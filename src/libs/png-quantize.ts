import { applyPalette, buildPalette, utils } from "image-q";

export interface RgbaImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export const pngOptimizationLevel = 2;

export interface PngQuantizationMetadata {
  readonly area: number;
  readonly colorCount: number;
  readonly hasAlpha: boolean;
}

export function shouldTryPngQuantization(metadata: PngQuantizationMetadata): boolean {
  if (metadata.hasAlpha) {
    return false;
  }

  return !(metadata.area > 2_000_000 && metadata.colorCount > 30_000);
}

export async function quantizePngPalette(imageData: RgbaImageData): Promise<RgbaImageData> {
  const points = utils.PointContainer.fromImageData(toImageDataLike(imageData));
  const palette = await buildPalette([points], {
    colorDistanceFormula: "pngquant",
    paletteQuantization: "wuquant",
    colors: 256,
  });
  const quantized = await applyPalette(points, palette, {
    colorDistanceFormula: "pngquant",
    imageQuantization: "floyd-steinberg",
  });

  return {
    data: new Uint8ClampedArray(quantized.toUint8Array()),
    width: imageData.width,
    height: imageData.height,
  };
}

export function estimatePngQuantizationQuality(source: RgbaImageData, quantized: RgbaImageData): number {
  if (source.width !== quantized.width || source.height !== quantized.height || source.data.length !== quantized.data.length) {
    return 0;
  }

  let colorSquaredError = 0;
  let colorSamples = 0;
  let maxColorError = 0;
  let alphaSquaredError = 0;
  let maxAlphaError = 0;
  const pixelCount = source.width * source.height;

  for (let offset = 0; offset + 3 < source.data.length; offset += 4) {
    const sourceAlpha = source.data[offset + 3] ?? 255;
    const quantizedAlpha = quantized.data[offset + 3] ?? 255;
    const alphaScale = sourceAlpha / 255;

    for (let channel = 0; channel < 3; channel += 1) {
      const delta = ((source.data[offset + channel] ?? 0) - (quantized.data[offset + channel] ?? 0)) * alphaScale;
      const absoluteDelta = Math.abs(delta);
      colorSquaredError += delta * delta;
      colorSamples += 1;
      if (absoluteDelta > maxColorError) {
        maxColorError = absoluteDelta;
      }
    }

    const alphaDelta = sourceAlpha - quantizedAlpha;
    alphaSquaredError += alphaDelta * alphaDelta;
    if (Math.abs(alphaDelta) > maxAlphaError) {
      maxAlphaError = Math.abs(alphaDelta);
    }
  }

  const colorRmse = Math.sqrt(colorSquaredError / Math.max(1, colorSamples));
  const alphaRmse = Math.sqrt(alphaSquaredError / Math.max(1, pixelCount));
  const quality = 100 - colorRmse * 5 - maxColorError * 0.1 - alphaRmse * 5 - maxAlphaError * 0.2;

  return Math.max(0, Math.min(100, quality));
}

export function acceptsPngQuantization(
  source: RgbaImageData,
  quantized: RgbaImageData,
  minQuality: number,
): boolean {
  return estimatePngQuantizationQuality(source, quantized) >= minQuality;
}

function toImageDataLike(imageData: RgbaImageData): ImageData {
  return {
    data: copyClampedArray(imageData.data),
    width: imageData.width,
    height: imageData.height,
    colorSpace: "srgb",
  };
}

function copyClampedArray(data: Uint8ClampedArray): Uint8ClampedArray<ArrayBuffer> {
  const copy = new Uint8ClampedArray(data.length);
  copy.set(data);
  return copy;
}
