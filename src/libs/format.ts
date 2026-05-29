export type SourceImageFormat = "png" | "jpg";
export type ImageFormat = SourceImageFormat | "webp" | "avif";

/*
 * Strategy routing must use the encoded format, not the filename. A renamed
 * image would otherwise be sent to the wrong codec and conversion candidate set.
 */
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

  if (isAvifFileType(buffer)) {
    return "avif";
  }

  return undefined;
}

function isAvifFileType(buffer: Uint8Array): boolean {
  if (
    buffer[4] !== 0x66 ||
    buffer[5] !== 0x74 ||
    buffer[6] !== 0x79 ||
    buffer[7] !== 0x70
  ) {
    return false;
  }

  for (let offset = 8; offset + 3 < Math.min(buffer.length, 32); offset += 4) {
    const brand =
      String.fromCharCode(buffer[offset] ?? 0) +
      String.fromCharCode(buffer[offset + 1] ?? 0) +
      String.fromCharCode(buffer[offset + 2] ?? 0) +
      String.fromCharCode(buffer[offset + 3] ?? 0);

    if (brand === "avif" || brand === "avis") {
      return true;
    }
  }

  return false;
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
