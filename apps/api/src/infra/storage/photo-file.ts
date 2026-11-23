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

export const unsupportedPhoto = () =>
  new UnsupportedMediaTypeException({
    code: 'UNSUPPORTED_FILE',
    message: 'Envoyez une photo JPEG, PNG ou WebP.',
  });

export const photoTooLarge = () =>
  new PayloadTooLargeException({ code: 'FILE_TOO_LARGE', message: 'La photo dépasse 5 Mo.' });

/** R2: 413 `FILE_TOO_LARGE` above 5 MB, 415 `UNSUPPORTED_FILE` for anything but a photo. */
export function assertPhoto(bytes: Uint8Array): PhotoType {
  if (bytes.length > MAX_PHOTO_BYTES) throw photoTooLarge();
  const type = sniffPhotoType(bytes);
  if (!type) throw unsupportedPhoto();
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

/** The end of the JPEG segment starting at `i` (a marker with its 2-byte length). */
function segmentEnd(bytes: Uint8Array, i: number): number {
  if (i + 3 >= bytes.length) throw unsupportedPhoto();
  const length = ((bytes[i + 2] as number) << 8) | (bytes[i + 3] as number);
  const end = i + 2 + length;
  if (length < 2 || end > bytes.length) throw unsupportedPhoto();
  return end;
}

/** APP2 « MPF »: the index of the extra images some phones append after the photo. */
function isMultiPicture(bytes: Uint8Array, i: number): boolean {
  return bytes[i + 1] === 0xe2 && ascii(bytes, i + 4, 4) === 'MPF\0';
}

/** What a JPEG segment between the image's start and its scans keeps: no EXIF/XMP, IPTC nor MPF. */
function keepsSegment(bytes: Uint8Array, i: number): boolean {
  const marker = bytes[i + 1] as number;
  return marker !== 0xe1 && marker !== 0xed && !isMultiPicture(bytes, i);
}

/** The EXIF orientation (1–8) in an APP1 payload (`Exif\0\0` + TIFF), or null. */
export function exifOrientation(payload: Uint8Array): number | null {
  if (ascii(payload, 0, 6) !== 'Exif\0\0') return null;
  const tiff = payload.subarray(6);
  const little = ascii(tiff, 0, 2) === 'II';
  if (!little && ascii(tiff, 0, 2) !== 'MM') return null;
  const u16 = (o: number) =>
    o + 2 > tiff.length
      ? null
      : little
        ? (tiff[o] as number) | ((tiff[o + 1] as number) << 8)
        : ((tiff[o] as number) << 8) | (tiff[o + 1] as number);
  const u32 = (o: number) => {
    const hi = u16(little ? o + 2 : o);
    const lo = u16(little ? o : o + 2);
    return hi === null || lo === null ? null : hi * 0x10000 + lo;
  };
  if (u16(2) !== 0x2a) return null;
  const ifd = u32(4);
  const count = ifd === null ? null : u16(ifd);
  if (ifd === null || count === null) return null;
  for (let k = 0; k < count; k += 1) {
    const entry = ifd + 2 + 12 * k;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value !== null && value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/** A minimal EXIF segment holding only the orientation, so a portrait photo still shows upright. */
function orientationSegment(orientation: number): Uint8Array {
  return Uint8Array.from([
    ...[0xff, 0xe1, 0x00, 0x22],
    ...Buffer.from('Exif\0\0', 'latin1'),
    ...[0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08], // big-endian TIFF, IFD0 at 8
    ...[0x00, 0x01], // one entry
    ...[0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00],
    ...[0x00, 0x00, 0x00, 0x00], // no next IFD
  ]);
}

/**
 * JPEG (FEAT-022-Q09, SPEC-022-04 « Erreurs et cas limites »): the image, and
 * nothing that says where or when it was taken. APP1 (EXIF, XMP) is replaced by
 * a minimal EXIF holding only the orientation (when it is not the normal one);
 * APP13 (IPTC) and APP2 « MPF » go; the scans are kept up to the image's end
 * (EOI) — what some phones append after it (extra images with their own EXIF,
 * trailers, videos) goes too (review of FEAT-022 parts 1-2, findings 5, 14).
 */
function stripJpeg(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let orientation: number | null = null;
  let i = 2; // after SOI
  // The segments before the first scan.
  for (;;) {
    if (i + 1 >= bytes.length || bytes[i] !== 0xff) throw unsupportedPhoto();
    const marker = bytes[i + 1] as number;
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0xd9) {
      parts.push(bytes.subarray(i, i + 2)); // end of image without a scan
      return finishJpeg(parts, orientation);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) throw unsupportedPhoto();
    const end = segmentEnd(bytes, i);
    if (marker === 0xe1) orientation ??= exifOrientation(bytes.subarray(i + 4, end));
    if (keepsSegment(bytes, i)) parts.push(bytes.subarray(i, end));
    i = end;
    if (marker === 0xda) break; // start of scan: its data follows
  }
  // The scans' data, and the segments between the scans of a progressive JPEG.
  let start = i;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const next = bytes[i + 1] as number;
    if (next === 0x00 || next === 0x01 || (next >= 0xd0 && next <= 0xd7)) {
      i += 2; // a stuffed 0xFF, or a marker without length inside the data
      continue;
    }
    if (next === 0xff) {
      i += 1; // fill byte before a marker
      continue;
    }
    parts.push(bytes.subarray(start, i));
    if (next === 0xd9) {
      parts.push(bytes.subarray(i, i + 2)); // EOI: whatever follows is dropped
      return finishJpeg(parts, orientation);
    }
    const end = segmentEnd(bytes, i);
    if (keepsSegment(bytes, i)) parts.push(bytes.subarray(i, end)); // DHT, DQT, DRI, SOS…
    i = end;
    start = i;
  }
  throw unsupportedPhoto(); // no end of image: a truncated file is never stored
}

function finishJpeg(parts: Uint8Array[], orientation: number | null): Uint8Array {
  const soi = Uint8Array.from([0xff, 0xd8]);
  return concat(
    orientation !== null && orientation !== 1
      ? [soi, orientationSegment(orientation), ...parts]
      : [soi, ...parts],
  );
}

const PNG_DROPPED = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

/** PNG: drop the EXIF chunk and the text chunks (XMP lives in iTXt). */
function stripPng(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let i = 8;
  while (i < bytes.length) {
    if (i + 8 > bytes.length) throw unsupportedPhoto();
    const length =
      (((bytes[i] as number) << 24) >>> 0) +
      ((bytes[i + 1] as number) << 16) +
      ((bytes[i + 2] as number) << 8) +
      (bytes[i + 3] as number);
    const type = ascii(bytes, i + 4, 4);
    const end = i + 12 + length; // length, type, data, CRC
    if (end > bytes.length) throw unsupportedPhoto();
    if (!PNG_DROPPED.has(type)) parts.push(bytes.subarray(i, end));
    i = end;
    if (type === 'IEND') return concat(parts);
  }
  throw unsupportedPhoto();
}

/** WebP: drop the EXIF and XMP chunks, clear their flags in VP8X, fix the RIFF size. */
function stripWebp(bytes: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let i = 12;
  while (i < bytes.length) {
    if (i + 8 > bytes.length) throw unsupportedPhoto();
    const fourcc = ascii(bytes, i, 4);
    const size =
      (bytes[i + 4] as number) |
      ((bytes[i + 5] as number) << 8) |
      ((bytes[i + 6] as number) << 16) |
      (((bytes[i + 7] as number) << 24) >>> 0);
    const end = i + 8 + size + (size % 2); // chunks are padded to an even size
    if (end > bytes.length) throw unsupportedPhoto();
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
