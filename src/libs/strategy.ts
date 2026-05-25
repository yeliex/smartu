import { type ImageFormat } from "./format.js";
import {
  clampQuality,
  selectJpegCompressionQuality,
  selectPngQuality,
  type QualityOptions,
} from "./quality.js";

export interface ImageMetadata {
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

export interface CompressionOptions extends QualityOptions {
  readonly allowFormatConversion?: boolean;
  readonly generateWebp?: boolean;
}

export function shouldUsePng8(metadata: ImageMetadata): boolean {
  return metadata.isPng8 || (!metadata.hasAlpha && metadata.colorCount < 256 && metadata.area <= 10_000);
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

/*
 * This function only decides which candidates are worth encoding. Runtime
 * adapters still compare actual output sizes after encoding before exposing or
 * writing any candidate.
 */
export function createCompressionPlan(
  metadata: ImageMetadata,
  options: CompressionOptions = {},
): CompressionPlan {
  const allowFormatConversion = options.allowFormatConversion ?? true;
  const generateWebp = options.generateWebp ?? false;

  /*
   * PNG primary output always stays PNG so alpha and palette information remain
   * safe by default. JPEG conversion is only planned for opaque inputs because
   * flattening transparency would change the image semantics.
   */
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

  /*
   * JPEG primary output is recompressed from estimated source quality. PNG is
   * only considered for limited-color images, then later discarded unless the
   * encoded candidate is actually smaller.
   */
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
    /*
     * GIF is kept as its own branch so runtimes can preserve animation when
     * their codec cannot safely produce an equivalent animated output.
     */
    return {
      branch: "gif",
      primary: {
        kind: "primary",
        format: "gif",
        reason: "gif-optimization",
      },
    };
  }

  /*
   * WebP inputs are recompressed as WebP only; alternate conversion is omitted
   * until there is a clear rule that can beat the source without format churn.
   */
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
