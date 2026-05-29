import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { compressImage } from "../src/node.js";
import { analyzeImage as analyzeBrowserImage } from "../src/browser.js";

describe("node compression runtime", () => {
  it("compresses same-format truecolor PNG inputs when conversion is disabled", async () => {
    const width = 256;
    const height = 256;
    const pixels = Buffer.alloc(width * height * 3);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 3;
        pixels[offset] = x;
        pixels[offset + 1] = y;
        pixels[offset + 2] = (x * y) % 256;
      }
    }

    const input = await sharp(pixels, { raw: { width, height, channels: 3 } })
      .png({ compressionLevel: 9, palette: false })
      .toBuffer();
    const result = await compressImage(input, { allowFormatConversion: false });

    assert.equal(result.plan.primary.format, "png");
    assert.equal(result.alternatives.length, 0);
    assert.equal(result.primary.compressed, true);
    assert.equal(result.primary.size < input.byteLength, true);
  });

  it("can plan explicit AVIF candidates for PNG inputs", async () => {
    const input = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: "#4f46e5",
      },
    })
      .png()
      .toBuffer();
    const result = await compressImage(input, { formats: ["auto", "avif"] });

    assert.equal(result.plan.primary.format, "png");
    assert.equal(result.plan.avif?.format, "avif");
  });

  it("rejects WebP and AVIF source inputs in the Node runtime", async () => {
    const source = sharp({
      create: {
        width: 16,
        height: 16,
        channels: 3,
        background: "#ffffff",
      },
    });
    const webp = await source.clone().webp().toBuffer();
    const avif = await source.clone().avif().toBuffer();

    await assert.rejects(() => compressImage(webp), /Unsupported image format: webp/);
    await assert.rejects(() => compressImage(avif), /Unsupported image format: heif|Unsupported image format: avif/);
  });

  it("rejects WebP and AVIF source inputs in the browser runtime", async () => {
    await assert.rejects(() => analyzeBrowserImage(webpFileType()), /Unsupported image format: webp/);
    await assert.rejects(() => analyzeBrowserImage(avifFileType()), /Unsupported image format: avif/);
  });
});

function webpFileType(): Uint8Array {
  return new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
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
