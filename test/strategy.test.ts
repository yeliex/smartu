import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectImageFormat, isPalettePng } from "../src/libs/format.js";
import {
  clampQuality,
  estimateJpegQuality,
  getQualityAdjustment,
  selectJpegBaseQuality,
  selectJpegCompressionQuality,
  selectPngQuality,
  usesPngAlphaQualityBranch,
} from "../src/libs/quality.js";
import {
  createCompressionPlan,
  shouldUsePng8,
  type ImageMetadata,
} from "../src/libs/strategy.js";
import { acceptsPngQuantization, estimatePngQuantizationQuality } from "../src/libs/png-quantize.js";

describe("format detection", () => {
  it("detects image formats from encoded bytes", () => {
    assert.equal(detectImageFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), "png");
    assert.equal(detectImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xdb])), "jpg");
    assert.equal(
      detectImageFormat(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
      "webp",
    );
    assert.equal(detectImageFormat(avifFileType()), "avif");
  });

  it("returns undefined for unsupported bytes", () => {
    assert.equal(detectImageFormat(new Uint8Array([0x00, 0x01, 0x02, 0x03])), undefined);
    assert.equal(detectImageFormat(new Uint8Array([0x47, 0x49, 0x46, 0x38])), undefined);
  });

  it("checks PNG palette color type from the IHDR byte", () => {
    const palettePng = new Uint8Array(25);
    palettePng.set([0x89, 0x50, 0x4e, 0x47]);
    palettePng[24] = 3;

    const truecolorPng = new Uint8Array(palettePng);
    truecolorPng[24] = 2;

    assert.equal(isPalettePng(palettePng), true);
    assert.equal(isPalettePng(truecolorPng), false);
  });
});

describe("quality selection", () => {
  it("maps quality presets to branch quality offsets", () => {
    assert.equal(getQualityAdjustment(), 0);
    assert.equal(getQualityAdjustment({ qualityPreset: "q1" }), 80);
    assert.equal(getQualityAdjustment({ qualityPreset: "q6" }), -15);
    assert.equal(getQualityAdjustment({ qualityPreset: "q1", qualityAdjustment: 12 }), 12);
  });

  it("keeps encoder quality inside the supported range", () => {
    assert.equal(clampQuality(-1), 10);
    assert.equal(clampQuality(0), 10);
    assert.equal(clampQuality(80.9), 80);
    assert.equal(clampQuality(100), 99);
  });

  it("selects PNG quality from alpha, color count, and source size", () => {
    assert.equal(selectPngQuality(pngMetadata()), 93);
    assert.equal(selectPngQuality(pngMetadata({ colorCount: 12_000 })), 90);
    assert.equal(selectPngQuality(pngMetadata({ hasAlpha: true })), 80);
    assert.equal(selectPngQuality(pngMetadata({ hasAlpha: true, colorCount: 12_000 })), 70);
    assert.equal(selectPngQuality(pngMetadata({ hasAlpha: true, size: 1024 * 1024 + 1 })), 10);
  });

  it("matches Zhitu's PNG alpha quality branch cutoff for large images", () => {
    assert.equal(usesPngAlphaQualityBranch(pngMetadata({ hasAlpha: true, area: 999_999 })), true);
    assert.equal(usesPngAlphaQualityBranch(pngMetadata({ hasAlpha: true, area: 1_000_000 })), false);
    assert.equal(
      selectPngQuality(
        pngMetadata({
          hasAlpha: true,
          area: 1_572_864,
          size: 2 * 1024 * 1024,
          colorCount: 30_001,
        }),
      ),
      90,
    );
  });

  it("applies explicit PNG quality adjustment once", () => {
    assert.equal(selectPngQuality(pngMetadata(), { qualityAdjustment: 5 }), 88);
  });

  it("selects JPEG base quality from estimated source quality", () => {
    assert.equal(selectJpegBaseQuality({ jpegQuality: 98, colorCount: 100 }), 88);
    assert.equal(selectJpegBaseQuality({ jpegQuality: 95, colorCount: 100 }), 93);
    assert.equal(selectJpegBaseQuality({ jpegQuality: 80, colorCount: 100 }), 80);
    assert.equal(selectJpegBaseQuality({ jpegQuality: 0, colorCount: 100 }), 75);
  });

  it("lowers JPEG compression quality for high-color images", () => {
    assert.equal(selectJpegCompressionQuality({ jpegQuality: 95, colorCount: 100 }), 88);
    assert.equal(selectJpegCompressionQuality({ jpegQuality: 95, colorCount: 12_000 }), 83);
    assert.equal(selectJpegCompressionQuality({ jpegQuality: 95, colorCount: 31_000 }), 78);
  });

  it("applies explicit JPEG quality adjustment once", () => {
    assert.equal(selectJpegBaseQuality({ jpegQuality: 95, colorCount: 100 }, { qualityAdjustment: 5 }), 88);
    assert.equal(selectJpegCompressionQuality({ jpegQuality: 95, colorCount: 100 }, { qualityAdjustment: 5 }), 83);
  });

  it("estimates JPEG source quality from the first quantization table", () => {
    assert.equal(estimateJpegQuality(new Uint8Array([0xff, 0xd8, 0xff, 0xda])), 75);
    assert.equal(estimateJpegQuality(jpegWithQuantizationTable()), 50);
  });

  it("gates PNG quantization candidates by an approximate pngquant-style quality floor", () => {
    const source = rgbaImageData([
      [100, 100, 100, 255],
      [110, 110, 110, 255],
    ]);
    const close = rgbaImageData([
      [101, 100, 100, 255],
      [109, 110, 110, 255],
    ]);
    const noisy = rgbaImageData([
      [160, 100, 100, 255],
      [40, 110, 110, 255],
    ]);

    assert.equal(acceptsPngQuantization(source, close, 90), true);
    assert.equal(acceptsPngQuantization(source, noisy, 90), false);
    assert.equal(estimatePngQuantizationQuality(source, close) > estimatePngQuantizationQuality(source, noisy), true);
  });
});

describe("compression strategy planning", () => {
  it("uses PNG8 for palette or very small low-color PNG inputs", () => {
    assert.equal(shouldUsePng8(metadata({ realFormat: "png", isPng8: true, colorCount: 300 })), true);
    assert.equal(shouldUsePng8(metadata({ realFormat: "png", colorCount: 200, area: 10_000 })), true);
    assert.equal(shouldUsePng8(metadata({ realFormat: "png", colorCount: 300, area: 10_001 })), false);
  });

  it("plans opaque PNG compression with JPEG and optional modern-format candidates", () => {
    const plan = createCompressionPlan(metadata({ realFormat: "png" }), { formats: ["auto", "webp", "avif"] });

    assert.equal(plan.branch, "png");
    assert.equal(plan.primary.format, "png");
    assert.equal(plan.primary.reason, "png-truecolor");
    assert.equal(plan.converted?.format, "jpg");
    assert.equal(plan.converted?.suffix, "-jpg");
    assert.equal(plan.webp?.format, "webp");
    assert.equal(plan.avif?.format, "avif");
  });

  it("keeps WebP and AVIF out of auto format conversion unless explicitly requested", () => {
    const plan = createCompressionPlan(metadata({ realFormat: "png" }), { formats: ["auto"] });

    assert.equal(plan.primary.format, "png");
    assert.equal(plan.converted?.format, "jpg");
    assert.equal(plan.webp, undefined);
    assert.equal(plan.avif, undefined);
  });

  it("adds AVIF through the explicit generator option", () => {
    const plan = createCompressionPlan(metadata({ realFormat: "jpg" }), { generateAvif: true });

    assert.equal(plan.primary.format, "jpg");
    assert.equal(plan.avif?.format, "avif");
    assert.equal(plan.avif?.quality, 80);
  });

  it("keeps the source format when automatic conversion is disabled", () => {
    const pngPlan = createCompressionPlan(metadata({ realFormat: "png" }), { allowFormatConversion: false });
    const jpgPlan = createCompressionPlan(metadata({ realFormat: "jpg", jpegQuality: 95, colorCount: 200 }), {
      allowFormatConversion: false,
    });

    assert.equal(pngPlan.primary.format, "png");
    assert.equal(pngPlan.converted, undefined);
    assert.equal(jpgPlan.primary.format, "jpg");
    assert.equal(jpgPlan.converted, undefined);
  });

  it("does not plan JPEG conversion for transparent PNG inputs", () => {
    const plan = createCompressionPlan(metadata({ realFormat: "png", hasAlpha: true }));

    assert.equal(plan.branch, "png");
    assert.equal(plan.primary.reason, "png-alpha");
    assert.equal(plan.converted, undefined);
  });

  it("routes large transparent PNG inputs like Zhitu's non-alpha branch", () => {
    const plan = createCompressionPlan(
      metadata({
        realFormat: "png",
        area: 1_572_864,
        size: 2 * 1024 * 1024,
        colorCount: 30_001,
        hasAlpha: true,
      }),
    );

    assert.equal(plan.branch, "png");
    assert.equal(plan.primary.reason, "png-truecolor");
    assert.equal(plan.primary.maxQuality, 90);
    assert.equal(plan.converted?.format, "jpg");
  });

  it("keeps modern formats as side candidates even when explicitly requested alone", () => {
    const plan = createCompressionPlan(metadata({ realFormat: "png" }), { formats: ["webp"] });

    assert.equal(plan.primary.format, "png");
    assert.equal(plan.converted, undefined);
    assert.equal(plan.webp?.format, "webp");
  });

  it("plans JPEG recompression and limited-color PNG conversion candidates", () => {
    const plan = createCompressionPlan(metadata({ realFormat: "jpg", jpegQuality: 95, colorCount: 200 }));

    assert.equal(plan.branch, "jpg");
    assert.equal(plan.primary.format, "jpg");
    assert.equal(plan.primary.quality, 88);
    assert.equal(plan.converted?.format, "png");
    assert.equal(plan.converted?.reason, "jpg-to-png8-smaller-candidate");
  });

  it("does not plan PNG conversion for very high-color JPEG inputs", () => {
    const plan = createCompressionPlan(metadata({ realFormat: "jpg", colorCount: 30_001 }));

    assert.equal(plan.converted, undefined);
  });

  it("uses explicit PNG/JPEG format lists instead of automatic conversion candidates", () => {
    const plan = createCompressionPlan(metadata({ realFormat: "png" }), { formats: ["jpg", "avif"] });

    assert.equal(plan.primary.format, "jpg");
    assert.equal(plan.converted, undefined);
    assert.equal(plan.avif?.format, "avif");
  });
});

function pngMetadata(
  overrides: Partial<Parameters<typeof selectPngQuality>[0]> = {},
): Parameters<typeof selectPngQuality>[0] {
  return {
    area: 100_000,
    size: 100_000,
    colorCount: 1000,
    hasAlpha: false,
    ...overrides,
  };
}

function metadata(overrides: Partial<ImageMetadata> = {}): ImageMetadata {
  return {
    realFormat: "png",
    width: 400,
    height: 300,
    area: 120_000,
    size: 100_000,
    colorCount: 1000,
    hasAlpha: false,
    isPng8: false,
    jpegQuality: 0,
    ...overrides,
  };
}

function rgbaImageData(pixels: readonly (readonly [number, number, number, number])[]): {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
} {
  const data = new Uint8ClampedArray(pixels.length * 4);

  for (const [index, pixel] of pixels.entries()) {
    data.set(pixel, index * 4);
  }

  return {
    data,
    width: pixels.length,
    height: 1,
  };
}

function jpegWithQuantizationTable(): Uint8Array {
  const luminanceTable = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55];
  const values = new Uint8Array(64);
  values.set(luminanceTable);

  const buffer = new Uint8Array(2 + 2 + 2 + 1 + values.length + 2);
  buffer.set([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00]);
  buffer.set(values, 7);
  buffer.set([0xff, 0xda], 71);
  return buffer;
}

function avifFileType(): Uint8Array {
  return new Uint8Array([
    0x00,
    0x00,
    0x00,
    0x18,
    0x66,
    0x74,
    0x79,
    0x70,
    0x61,
    0x76,
    0x69,
    0x66,
  ]);
}
