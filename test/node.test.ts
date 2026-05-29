import assert from "node:assert/strict";
import { describe, it } from "node:test";
import encodePng, { init as initPngEncode } from "@jsquash/png/encode.js";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { compressImage } from "../src/node.js";
import { analyzeImage as analyzeBrowserImage } from "../src/browser.js";

describe("node compression runtime", () => {
  it("compresses same-format truecolor PNG inputs when conversion is disabled", async () => {
    const width = 256;
    const height = 256;
    const pixels = new Uint8ClampedArray(width * height * 4);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        pixels[offset] = x;
        pixels[offset + 1] = y;
        pixels[offset + 2] = (x * y) % 256;
        pixels[offset + 3] = 255;
      }
    }

    const input = await createPng(pixels, width, height);
    const result = await compressImage(input, { allowFormatConversion: false });

    assert.equal(result.plan.primary.format, "png");
    assert.equal(result.alternatives.length, 0);
    assert.equal(result.primary.size <= input.byteLength, true);
  });

  it("can plan explicit AVIF candidates for PNG inputs", async () => {
    const input = await createPng(new Uint8ClampedArray(32 * 32 * 4).fill(255), 32, 32);
    const result = await compressImage(input, { formats: ["auto", "avif"] });

    assert.equal(result.plan.primary.format, "png");
    assert.equal(result.plan.avif?.format, "avif");
  });

  it("rejects WebP and AVIF source inputs in the Node runtime", async () => {
    await assert.rejects(() => compressImage(webpFileType()), /Unsupported image format: webp/);
    await assert.rejects(() => compressImage(avifFileType()), /Unsupported image format: avif/);
  });

  it("rejects WebP and AVIF source inputs in the browser runtime", async () => {
    await assert.rejects(() => analyzeBrowserImage(webpFileType()), /Unsupported image format: webp/);
    await assert.rejects(() => analyzeBrowserImage(avifFileType()), /Unsupported image format: avif/);
  });
});

let pngEncodeReady: ReturnType<typeof initPngEncode> | undefined;

async function createPng(data: Uint8ClampedArray, width: number, height: number): Promise<Uint8Array> {
  if (!pngEncodeReady) {
    const require = createRequire(import.meta.url);
    const packagePath = path.dirname(require.resolve("@jsquash/png/package.json"));
    pngEncodeReady = initPngEncode(await fs.readFile(path.join(packagePath, "codec/pkg/squoosh_png_bg.wasm")));
  }

  await pngEncodeReady;
  const copy = new Uint8ClampedArray(data.length);
  copy.set(data);
  return new Uint8Array(
    await encodePng({
      data: copy,
      width,
      height,
      colorSpace: "srgb",
    }),
  );
}

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
