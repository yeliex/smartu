import { type ImageFormat, type SourceImageFormat } from "./format.ts";
import {
  clampQuality,
  selectJpegCompressionQuality,
  selectPngQuality,
  usesPngAlphaQualityBranch,
  type QualityOptions,
} from "./quality.ts";

export type CompressionFormat = ImageFormat | "auto";

export interface ImageMetadata {
  readonly realFormat: SourceImageFormat;
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
  readonly formats?: readonly CompressionFormat[];
  readonly allowFormatConversion?: boolean;
  readonly generateWebp?: boolean;
  readonly generateAvif?: boolean;
}

export function shouldUsePng8(metadata: ImageMetadata): boolean {
  return (
    metadata.isPng8 ||
    (!usesPngAlphaQualityBranch(metadata) && metadata.colorCount < 256 && metadata.area <= 10_000)
  );
}

export interface StrategyCandidate {
  readonly kind: "primary" | "converted" | "webp" | "avif";
  readonly format: ImageFormat;
  readonly quality?: number;
  readonly minQuality?: number;
  readonly maxQuality?: number;
  readonly suffix?: string;
  readonly reason: string;
}

export interface CompressionPlan {
  readonly branch: "png" | "png8" | "jpg";
  readonly primary: StrategyCandidate;
  readonly converted?: StrategyCandidate;
  readonly webp?: StrategyCandidate;
  readonly avif?: StrategyCandidate;
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

interface CandidateTemplate {
  readonly format: ImageFormat;
  readonly quality?: number;
  readonly minQuality?: number;
  readonly maxQuality?: number;
  readonly suffix?: string;
  readonly reason: string;
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
  const formats = resolveFormats(options);
  const allowFormatConversion = options.allowFormatConversion ?? true;

  /*
   * Auto mode keeps PNG as the primary output so alpha and palette information
   * remain safe by default. WebP and AVIF stay explicit side candidates because
   * Smartu's default job is compression, not modern-format conversion.
   */
  if (metadata.realFormat === "png") {
    const usePng8 = shouldUsePng8(metadata);
    const hasAlphaForStrategy = usesPngAlphaQualityBranch(metadata);
    const pngQuality = usePng8 ? 90 : selectPngQuality(metadata, options);
    const png: CandidateTemplate = {
      format: "png",
      minQuality: clampQuality(pngQuality - 1),
      maxQuality: pngQuality,
      reason: usePng8 ? "png8-palette" : hasAlphaForStrategy ? "png-alpha" : "png-truecolor",
    };
    const jpg: CandidateTemplate = {
      format: "jpg",
      quality: pngQuality,
      suffix: "-jpg",
      reason: "png-to-jpg-smaller-candidate",
    };
    const webp = createWebpCandidate();
    const avif = createAvifCandidate();
    const candidates: CandidateTemplate[] = [];

    addRequestedCandidates(candidates, formats, {
      auto: [png, ...(allowFormatConversion && !hasAlphaForStrategy ? [jpg] : [])],
      explicit: {
        png,
        jpg,
        webp,
        avif,
      },
      fallback: png,
    });

    return createPlan(usePng8 ? "png8" : "png", prioritizePrimary(candidates, png));
  }

  /*
   * Auto mode recompresses JPEG from estimated source quality. PNG is only
   * considered for limited-color images, then later discarded unless the
   * encoded candidate is actually smaller.
   */
  if (metadata.realFormat === "jpg") {
    const jpegQuality = selectJpegCompressionQuality(metadata, options);
    const jpg: CandidateTemplate = {
      format: "jpg",
      quality: jpegQuality,
      reason: "jpeg-recompression",
    };
    const png: CandidateTemplate = {
      format: "png",
      suffix: "-png",
      reason: metadata.colorCount < 256 ? "jpg-to-png8-smaller-candidate" : "jpg-to-png-smaller-candidate",
    };
    const webp = createWebpCandidate();
    const avif = createAvifCandidate();
    const candidates: CandidateTemplate[] = [];

    addRequestedCandidates(candidates, formats, {
      auto: [jpg, ...(allowFormatConversion && metadata.colorCount <= 30_000 ? [png] : [])],
      explicit: {
        jpg,
        png: metadata.colorCount <= 30_000 ? png : undefined,
        webp,
        avif,
      },
      fallback: jpg,
    });

    return createPlan("jpg", prioritizePrimary(candidates, jpg));
  }

  throw new Error("Unsupported source format.");
}

function resolveFormats(options: CompressionOptions): readonly CompressionFormat[] {
  const formats: CompressionFormat[] = options.formats?.length ? [...options.formats] : ["auto"];

  if (options.generateWebp === true && !formats.includes("webp")) {
    formats.push("webp");
  }

  if (options.generateAvif === true && !formats.includes("avif")) {
    formats.push("avif");
  }

  return formats;
}

function addRequestedCandidates(
  candidates: CandidateTemplate[],
  formats: readonly CompressionFormat[],
  sources: {
    readonly auto: readonly CandidateTemplate[];
    readonly explicit: Partial<Record<ImageFormat, CandidateTemplate>>;
    readonly fallback: CandidateTemplate;
  },
): void {
  for (const format of formats) {
    if (format === "auto") {
      for (const candidate of sources.auto) {
        addCandidate(candidates, candidate);
      }
      continue;
    }

    const candidate = sources.explicit[format];
    if (candidate) {
      addCandidate(candidates, candidate);
    }
  }

  if (candidates.length === 0) {
    addCandidate(candidates, sources.fallback);
  }
}

function addCandidate(candidates: CandidateTemplate[], candidate: CandidateTemplate): void {
  if (!candidates.some((existing) => existing.format === candidate.format)) {
    candidates.push(candidate);
  }
}

function createWebpCandidate(): CandidateTemplate {
  return {
    format: "webp",
    quality: 80,
    suffix: "-webp",
    reason: "webp-candidate",
  };
}

function createAvifCandidate(): CandidateTemplate {
  return {
    format: "avif",
    quality: 80,
    suffix: "-avif",
    reason: "avif-candidate",
  };
}

function prioritizePrimary(
  candidates: readonly CandidateTemplate[],
  fallback: CandidateTemplate,
): readonly CandidateTemplate[] {
  const primary = candidates.find((candidate) => !isModernCandidate(candidate)) ?? fallback;
  const alternatives = candidates.filter((candidate) => candidate.format !== primary.format);
  return [primary, ...alternatives];
}

function isModernCandidate(candidate: CandidateTemplate): boolean {
  return candidate.format === "webp" || candidate.format === "avif";
}

function createPlan(branch: CompressionPlan["branch"], candidates: readonly CandidateTemplate[]): CompressionPlan {
  const [primary, ...alternatives] = candidates;

  if (!primary) {
    throw new Error("Compression plan requires at least one candidate.");
  }

  const converted = alternatives.find((candidate) => candidate.format !== "webp" && candidate.format !== "avif");
  const webp = alternatives.find((candidate) => candidate.format === "webp");
  const avif = alternatives.find((candidate) => candidate.format === "avif");

  return {
    branch,
    primary: toStrategyCandidate(primary, "primary"),
    converted: converted ? toStrategyCandidate(converted, "converted") : undefined,
    webp: webp ? toStrategyCandidate(webp, "webp") : undefined,
    avif: avif ? toStrategyCandidate(avif, "avif") : undefined,
  };
}

function toStrategyCandidate(template: CandidateTemplate, kind: StrategyCandidate["kind"]): StrategyCandidate {
  return {
    kind,
    format: template.format,
    quality: template.quality,
    minQuality: template.minQuality,
    maxQuality: template.maxQuality,
    suffix: kind === "primary" ? undefined : template.suffix,
    reason: template.reason,
  };
}
