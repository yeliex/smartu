export type ImageFormat = "png" | "jpg" | "gif" | "webp";

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

export function isPalettePng(buffer: Uint8Array): boolean {
  return (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[24] === 3
  );
}
