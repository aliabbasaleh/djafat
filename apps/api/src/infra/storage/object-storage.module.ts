import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { Global, Injectable, Logger, Module, ServiceUnavailableException } from '@nestjs/common';
import type { ObjectStoragePort } from '@djafat/types';
import { AppConfigService } from '../../common/config/config.service';
import { FILE_STORE, OBJECT_STORAGE } from './object-storage.tokens';
import { FilesystemObjectStorage } from './filesystem-object-storage';
import { FilesController } from './files.controller';
import { PhotoStorage } from './photo-storage';

export { OBJECT_STORAGE, FILE_STORE } from './object-storage.tokens';

const notConfigured = () =>
  new ServiceUnavailableException({
    code: 'STORAGE_NOT_CONFIGURED',
    message: "L'envoi de photos n'est pas encore configuré sur ce serveur.",
  });

/**
 * No storage on this server (driver `none`, or production without
 * `OBJECT_STORAGE_DIR`): every call answers 503 `STORAGE_NOT_CONFIGURED`.
 */
@Injectable()
export class NotConfiguredObjectStorage implements ObjectStoragePort {
  putObject(): Promise<{ key: string }> {
    return Promise.reject(notConfigured());
  }
  getSignedUrl(): Promise<string> {
    return Promise.reject(notConfigured());
  }
  deleteObject(): Promise<void> {
    return Promise.reject(notConfigured());
  }
}

/** FEAT-022 (SPEC-022-04): the disk folder, or null when files must not be stored here. */
export function fileStoreDir(env: {
  NODE_ENV: string;
  OBJECT_STORAGE_DRIVER: 'none' | 'filesystem';
  OBJECT_STORAGE_DIR?: string | undefined;
}): string | null {
  if (env.OBJECT_STORAGE_DRIVER !== 'filesystem') return null;
  if (env.OBJECT_STORAGE_DIR) return env.OBJECT_STORAGE_DIR;
  // Production never falls back to a temporary folder: files would be lost (R5).
  return env.NODE_ENV === 'production' ? null : join(tmpdir(), 'djafat-uploads');
}

/** The key of the signed links: its own secret, or one derived from JWT_ACCESS_SECRET. */
export function fileUrlSecret(env: {
  FILE_URL_SECRET?: string | undefined;
  JWT_ACCESS_SECRET: string;
}): string {
  return (
    env.FILE_URL_SECRET ??
    createHmac('sha256', env.JWT_ACCESS_SECRET).update('djafat-file-urls').digest('hex')
  );
}

/**
 * Files (decision A6, FEAT-022 SPEC-022-04): the server-disk adapter behind
 * `ObjectStoragePort`, chosen by configuration; `GET /files/:key`; and
 * `PhotoStorage`, the application's way to store a photo.
 */
@Global()
@Module({
  controllers: [FilesController],
  providers: [
    {
      provide: FILE_STORE,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): FilesystemObjectStorage | null => {
        const env = {
          NODE_ENV: config.get('NODE_ENV'),
          OBJECT_STORAGE_DRIVER: config.get('OBJECT_STORAGE_DRIVER'),
          OBJECT_STORAGE_DIR: config.get('OBJECT_STORAGE_DIR'),
        };
        const dir = fileStoreDir(env);
        const logger = new Logger('ObjectStorage');
        if (!dir) {
          logger.warn(
            env.OBJECT_STORAGE_DRIVER === 'filesystem'
              ? 'OBJECT_STORAGE_DIR is not set: photos cannot be stored (503) until it is.'
              : 'Object storage driver "none": photos cannot be stored (503).',
          );
          return null;
        }
        logger.log(`Photos stored on disk in ${dir}`);
        return new FilesystemObjectStorage(
          dir,
          config.get('API_PUBLIC_URL'),
          fileUrlSecret({
            FILE_URL_SECRET: config.get('FILE_URL_SECRET'),
            JWT_ACCESS_SECRET: config.get('JWT_ACCESS_SECRET'),
          }),
        );
      },
    },
    {
      provide: OBJECT_STORAGE,
      inject: [FILE_STORE],
      useFactory: (files: FilesystemObjectStorage | null): ObjectStoragePort =>
        files ?? new NotConfiguredObjectStorage(),
    },
    PhotoStorage,
  ],
  exports: [OBJECT_STORAGE, PhotoStorage],
})
export class ObjectStorageModule {}
