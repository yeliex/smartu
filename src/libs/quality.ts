export type QualityPreset = "q1" | "q2" | "q3" | "q4" | "q5" | "q6";

const qualityPresetAdjustments: Record<QualityPreset, number> = {
  q1: 80,
  q2: 60,
  q3: 40,
  q4: 20,
  q5: 0,
  q6: -15,
};

export interface QualityOptions {
  readonly qualityPreset?: QualityPreset;
  readonly qualityAdjustment?: number;
}

/*
 * Quality presets model Zhitu's buttons as offsets from the branch-selected
 * base quality. This keeps PNG/JPEG threshold logic in one place while letting
 * callers make every branch more or less aggressive with the same option.
 */
export function getQualityAdjustment(options: QualityOptions = {}): number {
  if (typeof options.qualityAdjustment === "number") {
    return options.qualityAdjustment;
  }

  if (options.qualityPreset) {
    return qualityPresetAdjustments[options.qualityPreset];
  }

  return 0;
}

export function clampQuality(quality: number): number {
  if (quality <= 0) {
    return 10;
  }

  if (quality >= 100) {
    return 99;
  }

  return Math.trunc(quality);
}

interface PngQualityMetadata {
  readonly area: number;
  readonly size: number;
  readonly colorCount: number;
  readonly hasAlpha: boolean;
}

/*
 * PNG quality comes from image structure instead of a single global value.
 * Alpha-heavy or high-color images are more sensitive to visible artifacts, so
 * the strategy lowers quality more cautiously unless the source is clearly
 * large enough to justify aggressive quantization.
 */
export function selectPngQuality(metadata: PngQualityMetadata, options: QualityOptions = {}): number {
  let quality: number;

  if (metadata.hasAlpha) {
    quality = 80;
    if (metadata.colorCount > 10_000) {
      quality = 70;
    }
    if (metadata.size > 1024 * 1024 || metadata.colorCount > 30_000) {
      quality = 10;
    }
  } else {
    quality = 93;
    if (metadata.colorCount > 10_000) {
      quality = 90;
    }
    if (metadata.area > 1024 * 1024 || metadata.colorCount > 30_000) {
      quality = metadata.colorCount < 3000 ? 92 : 90;
    }
  }

  return clampQuality(quality - getQualityAdjustment(options));
}

interface JpegQualityMetadata {
  readonly jpegQuality: number;
  readonly colorCount: number;
}

/*
 * Very high source quality usually means the image has spare bytes to remove;
 * lower-quality sources stay close to their estimated original quality to avoid
 * compounding artifacts from a previous lossy encode.
 */
export function selectJpegBaseQuality(metadata: JpegQualityMetadata, options: QualityOptions = {}): number {
  let quality: number;

  if (metadata.jpegQuality > 93) {
    quality = metadata.jpegQuality >= 97 ? 88 : 93;
  } else {
    quality = metadata.jpegQuality === 0 ? 75 : metadata.jpegQuality;
  }

  return clampQuality(quality - getQualityAdjustment(options));
}

export function selectJpegCompressionQuality(
  metadata: JpegQualityMetadata,
  options: QualityOptions = {},
): number {
  const baseQuality = selectJpegBaseQuality(metadata, options);
  let quality = baseQuality - 5;

  if (metadata.colorCount > 10_000) {
    quality = baseQuality - 10;
  }
  if (metadata.colorCount > 30_000) {
    quality = baseQuality - 15;
  }

  return clampQuality(quality - getQualityAdjustment(options));
}

export function estimateJpegQuality(buffer: Uint8Array): number {
  const table = readFirstJpegQuantizationTable(buffer);
  if (!table) {
    return 75;
  }

  /*
   * Compare the first quantization values against the standard luminance table.
   * The average scale is then converted through the common JPEG quality formula,
   * which gives the strategy a stable approximation without relying on metadata.
   */
  const luminanceTable = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55];
  const ratios = table.slice(0, luminanceTable.length).map((value, index) => (value * 100) / (luminanceTable[index] ?? 1));
  const scale = ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;

  if (scale <= 0) {
    return 75;
  }

  const quality = scale <= 100 ? (200 - scale) / 2 : 5000 / scale;
  return Math.max(1, Math.min(100, Math.round(quality)));
}

/*
 * JPEG source quality is inferred from DQT markers because the original quality
 * is not exposed as metadata. If the scan starts before a table is found, the
 * caller falls back to the conservative default quality.
 */
function readFirstJpegQuantizationTable(buffer: Uint8Array): number[] | undefined {
  let offset = 2;

  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return undefined;
  }

  while (offset + 4 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    if (marker === 0xda || marker === 0xd9) {
      return undefined;
    }

    const segmentLength = ((buffer[offset + 2] ?? 0) << 8) + (buffer[offset + 3] ?? 0);
    if (segmentLength < 2 || offset + 2 + segmentLength > buffer.length) {
      return undefined;
    }

    if (marker === 0xdb) {
      const precisionAndId = buffer[offset + 4] ?? 0;
      const precision = precisionAndId >> 4;
      const valueSize = precision === 0 ? 1 : 2;
      const values: number[] = [];
      let tableOffset = offset + 5;

      for (let index = 0; index < 64 && tableOffset + valueSize - 1 < offset + 2 + segmentLength; index += 1) {
        if (valueSize === 1) {
          values.push(buffer[tableOffset] ?? 0);
        } else {
          values.push(((buffer[tableOffset] ?? 0) << 8) + (buffer[tableOffset + 1] ?? 0));
        }
        tableOffset += valueSize;
      }

      return values.length === 64 ? values : undefined;
    }

    offset += 2 + segmentLength;
  }

  return undefined;
}
