/**
 * FEAT-022 (SPEC-022-04 R2, FEAT-022-Q09): a photo is reduced in the browser
 * before it leaves — a phone photo of a paper easily passes the API's 5 MB.
 */

/** Above this, the photo is redrawn smaller (the API refuses more than 5 MB). */
export const SHRINK_ABOVE_BYTES = 4 * 1024 * 1024;
/** The longest side after reduction: still sharp enough to read a paper. */
export const MAX_SIDE_PX = 2560;

/** The size a photo is redrawn at: never larger, the longest side at most `maxSide`. */
export function scaledSize(
  width: number,
  height: number,
  maxSide: number = MAX_SIDE_PX,
): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height, 1));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * The bytes to send: the file itself when small enough, else a JPEG redrawn
 * at `scaledSize`. A photo the browser cannot read (an iPhone HEIC, say)
 * leaves as it is: the API answers with its own message (413 or 415).
 */
export async function photoForUpload(file: Blob): Promise<Blob> {
  if (file.size <= SHRINK_ABOVE_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const size = scaledSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close();
    const reduced = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    return reduced && reduced.size < file.size ? reduced : file;
  } catch {
    return file;
  }
}
