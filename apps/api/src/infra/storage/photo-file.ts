import { PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';

/**
 * FEAT-022 (SPEC-022-04 R2 and « Erreurs et cas limites »): a photo is a JPEG,
 * PNG or WebP of 5 MB at most, recognised by its first bytes (never by its name),
 * and stored without its metadata — EXIF (the position and date a phone writes)
 * and XMP — removed by dropping their segments, without re-encoding the image
 * (no native image library, SPEC-022-04 v2).
 */

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export type PhotoType = 'jpg' | 'png' | 'webp';

export const PHOTO_CONTENT_TYPES: Readonly<Record<PhotoType, string>> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/** The photo type from its first bytes, or null. */
export function sniffPhotoType(bytes: Uint8Array): PhotoType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'jpg';
  if (bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return 'png';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return 'webp';
  }
  return null;
}

const unsupported = () =>
  new UnsupportedMediaTypeException({
    code: 'UNSUPPORTED_FILE',
    message: 'Envoyez une photo JPEG, PNG ou WebP.',
  });

/** R2: 413 `FILE_TOO_LARGE` above 5 MB, 415 `UNSUPPORTED_FILE` for anything but a photo. */
export function assertPhoto(bytes: Uint8Array): PhotoType {
  if (bytes.length > MAX_PHOTO_BYTES) {
    throw new PayloadTooLargeException({
      code: 'FILE_TOO_LARGE',
      message: 'La photo dépasse 5 Mo.',
    });
  }
  const type = sniffPhotoType(bytes);
  if (!type) throw unsupported();
  return type;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** JPEG: drop APP1 (EXIF, XMP) and APP13 (IPTC) segments; everything from the scan on is kept as is. */
function stripJpeg(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 2)]; // SOI
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff || i + 1 >= bytes.length) throw unsupported();
    const marker = bytes[i + 1] as number;
    if (marker === 0xda) {
      parts.push(bytes.subarray(i)); // start of scan: image data to the end
      return concat(parts);
    }
    if (marker === 0xd9) {
      parts.push(bytes.subarray(i, i + 2)); // end of image without a scan
      return concat(parts);
    }
    if (i + 3 >= bytes.length) throw unsupported();
    const length = ((bytes[i + 2] as number) << 8) | (bytes[i + 3] as number);
    const end = i + 2 + length;
    if (length < 2 || end > bytes.length) throw unsupported();
    if (marker !== 0xe1 && marker !== 0xed) parts.push(bytes.subarray(i, end));
    i = end;
  }
  throw unsupported();
}

const PNG_DROPPED = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

/** PNG: drop the EXIF chunk and the text chunks (XMP lives in iTXt). */
function stripPng(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let i = 8;
  while (i < bytes.length) {
    if (i + 8 > bytes.length) throw unsupported();
    const length =
      (((bytes[i] as number) << 24) >>> 0) +
      ((bytes[i + 1] as number) << 16) +
      ((bytes[i + 2] as number) << 8) +
      (bytes[i + 3] as number);
    const type = ascii(bytes, i + 4, 4);
    const end = i + 12 + length; // length, type, data, CRC
    if (end > bytes.length) throw unsupported();
    if (!PNG_DROPPED.has(type)) parts.push(bytes.subarray(i, end));
    i = end;
    if (type === 'IEND') return concat(parts);
  }
  throw unsupported();
}

/** WebP: drop the EXIF and XMP chunks, clear their flags in VP8X, fix the RIFF size. */
function stripWebp(bytes: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let i = 12;
  while (i < bytes.length) {
    if (i + 8 > bytes.length) throw unsupported();
    const fourcc = ascii(bytes, i, 4);
    const size =
      (bytes[i + 4] as number) |
      ((bytes[i + 5] as number) << 8) |
      ((bytes[i + 6] as number) << 16) |
      (((bytes[i + 7] as number) << 24) >>> 0);
    const end = i + 8 + size + (size % 2); // chunks are padded to an even size
    if (end > bytes.length) throw unsupported();
    if (fourcc !== 'EXIF' && fourcc !== 'XMP ') {
      const chunk = bytes.slice(i, end);
      if (fourcc === 'VP8X' && chunk.length > 8) chunk[8] = (chunk[8] as number) & ~0x0c; // XMP 0x04, EXIF 0x08
      chunks.push(chunk);
    }
    i = end;
  }
  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set(bytes.subarray(0, 12));
  const riffSize = body.length + 4; // "WEBP" + chunks
  header[4] = riffSize & 0xff;
  header[5] = (riffSize >>> 8) & 0xff;
  header[6] = (riffSize >>> 16) & 0xff;
  header[7] = (riffSize >>> 24) & 0xff;
  return concat([header, body]);
}

/** The photo without its EXIF and XMP metadata; a malformed file is refused (415). */
export function stripPhotoMetadata(bytes: Uint8Array, type: PhotoType): Uint8Array {
  if (type === 'jpg') return stripJpeg(bytes);
  if (type === 'png') return stripPng(bytes);
  return stripWebp(bytes);
}
