import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { compressImage } from "../src/node.js";

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
});
