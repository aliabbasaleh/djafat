import { Inject, Injectable } from '@nestjs/common';
import type { ObjectStoragePort } from '@djafat/types';
import { OBJECT_STORAGE } from './object-storage.tokens';
import { newFileKey, type FileFamily } from './file-keys';
import { PHOTO_CONTENT_TYPES, assertPhoto, stripPhotoMetadata } from './photo-file';

/** A private file's link lives 5 minutes (SPEC-022-04 R3). */
export const PRIVATE_LINK_SECONDS = 5 * 60;

/**
 * FEAT-022 (SPEC-022-04): how the application stores a photo — checked (type
 * from its bytes, 5 MB at most), stripped of its metadata, saved under a random
 * key of its family — and how it hands out a link to it. Callers decide who may
 * ask (the owner of the application, or an admin).
 */
@Injectable()
export class PhotoStorage {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort) {}

  async store(family: FileFamily, bytes: Uint8Array): Promise<{ key: string }> {
    const type = assertPhoto(bytes);
    const clean = stripPhotoMetadata(bytes, type);
    return this.storage.putObject(newFileKey(family, type), clean, PHOTO_CONTENT_TYPES[type]);
  }

  /** A public file's address, or a private file's 5-minute link. */
  link(key: string): Promise<string> {
    return this.storage.getSignedUrl(key, PRIVATE_LINK_SECONDS);
  }

  remove(key: string): Promise<void> {
    return this.storage.deleteObject(key);
  }
}
