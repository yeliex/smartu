export type ImageFormat = "png" | "jpg" | "gif" | "webp";

export type QualityPreset = "q1" | "q2" | "q3" | "q4" | "q5" | "q6";

export interface ImageMetadata {
  readonly path?: string;
  readonly visibleFormat?: string;
  readonly realFormat: ImageFormat;
  readonly width: number;
  readonly height: number;
  readonly area: number;
  readonly size: number;
  readonly colorCount: number;
  readonly hasAlpha: boolean;
  readonly isPng8: boolean;
  readonly jpegQuality: number;
}

export interface CompressionOptions {
  readonly allowFormatConversion?: boolean;
  readonly generateWebp?: boolean;
  readonly qualityPreset?: QualityPreset;
  readonly qualityAdjustment?: number;
}

export interface StrategyCandidate {
  readonly kind: "primary" | "converted" | "webp";
  readonly format: ImageFormat;
  readonly quality?: number;
  readonly minQuality?: number;
  readonly maxQuality?: number;
  readonly suffix?: string;
  readonly reason: string;
}

export interface CompressionPlan {
  readonly branch: "png" | "png8" | "jpg" | "gif" | "webp";
  readonly primary: StrategyCandidate;
  readonly converted?: StrategyCandidate;
  readonly webp?: StrategyCandidate;
}

export interface CompressionOutput {
  readonly kind: StrategyCandidate["kind"];
  readonly format: ImageFormat;
  readonly buffer: Uint8Array;
  readonly size: number;
  readonly compressed: boolean;
  readonly suffix?: string;
  readonly reason: string;
}

export interface CompressionResult {
  readonly metadata: ImageMetadata;
  readonly plan: CompressionPlan;
  readonly primary: CompressionOutput;
  readonly alternatives: readonly CompressionOutput[];
}

export function detectImageFormat(buffer: Uint8Array): ImageFormat | undefined {
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "png";
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return "jpg";
  }

  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46
  ) {
    return "gif";
  }

  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "webp";
  }

  return undefined;
}

export function estimateJpegQuality(buffer: Uint8Array): number {
  const table = readFirstJpegQuantizationTable(buffer);
  if (!table) {
    return 75;
  }

  const luminanceTable = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55];
  const ratios = table.slice(0, luminanceTable.length).map((value, index) => (value * 100) / (luminanceTable[index] ?? 1));
  const scale = ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;

  if (scale <= 0) {
    return 75;
  }

  const quality = scale <= 100 ? (200 - scale) / 2 : 5000 / scale;
  return Math.max(1, Math.min(100, Math.round(quality)));
}

export function isPalettePng(buffer: Uint8Array): boolean {
  return (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[24] === 3
  );
}

export function extensionForFormat(format: ImageFormat): string {
  return format === "jpg" ? "jpg" : format;
}

const qualityPresetAdjustments: Record<QualityPreset, number> = {
  q1: 80,
  q2: 60,
  q3: 40,
  q4: 20,
  q5: 0,
  q6: -15,
};

export function getQualityAdjustment(options: CompressionOptions = {}): number {
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

export function selectPngQuality(metadata: ImageMetadata, options: CompressionOptions = {}): number {
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

export function selectJpegBaseQuality(metadata: ImageMetadata, options: CompressionOptions = {}): number {
  let quality: number;

  if (metadata.jpegQuality > 93) {
    quality = metadata.jpegQuality >= 97 ? 88 : 93;
  } else {
    quality = metadata.jpegQuality === 0 ? 75 : metadata.jpegQuality;
  }

  return clampQuality(quality - getQualityAdjustment(options));
}

export function selectJpegCompressionQuality(
  metadata: ImageMetadata,
  options: CompressionOptions = {},
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

export function shouldUsePng8(metadata: ImageMetadata): boolean {
  return metadata.isPng8 || (!metadata.hasAlpha && metadata.colorCount < 256 && metadata.area <= 10_000);
}

export function createCompressionPlan(
  metadata: ImageMetadata,
  options: CompressionOptions = {},
): CompressionPlan {
  const allowFormatConversion = options.allowFormatConversion ?? true;
  const generateWebp = options.generateWebp ?? false;

  if (metadata.realFormat === "png") {
    const usePng8 = shouldUsePng8(metadata);
    const pngQuality = usePng8 ? 90 : selectPngQuality(metadata, options);
    const plan: CompressionPlan = {
      branch: usePng8 ? "png8" : "png",
      primary: {
        kind: "primary",
        format: "png",
        minQuality: clampQuality(pngQuality - 1),
        maxQuality: pngQuality,
        reason: usePng8 ? "png8-palette" : metadata.hasAlpha ? "png-alpha" : "png-truecolor",
      },
      converted:
        allowFormatConversion && !metadata.hasAlpha
          ? {
              kind: "converted",
              format: "jpg",
              quality: pngQuality,
              suffix: "-jpg",
              reason: "png-to-jpg-smaller-candidate",
            }
          : undefined,
      webp: generateWebp
        ? {
            kind: "webp",
            format: "webp",
            quality: 80,
            suffix: "-webp",
            reason: "webp-candidate",
          }
        : undefined,
    };

    return plan;
  }

  if (metadata.realFormat === "jpg") {
    const jpegQuality = selectJpegCompressionQuality(metadata, options);
    const plan: CompressionPlan = {
      branch: "jpg",
      primary: {
        kind: "primary",
        format: "jpg",
        quality: jpegQuality,
        reason: "jpeg-recompression",
      },
      converted:
        allowFormatConversion && metadata.colorCount <= 30_000
          ? {
              kind: "converted",
              format: "png",
              suffix: "-png",
              reason: metadata.colorCount < 256 ? "jpg-to-png8-smaller-candidate" : "jpg-to-png-smaller-candidate",
            }
          : undefined,
      webp: generateWebp
        ? {
            kind: "webp",
            format: "webp",
            quality: 80,
            suffix: "-webp",
            reason: "webp-candidate",
          }
        : undefined,
    };

    return plan;
  }

  if (metadata.realFormat === "gif") {
    return {
      branch: "gif",
      primary: {
        kind: "primary",
        format: "gif",
        reason: "gif-optimization",
      },
    };
  }

  return {
    branch: "webp",
    primary: {
      kind: "primary",
      format: "webp",
      quality: 80,
      reason: "webp-recompression",
    },
  };
}

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
