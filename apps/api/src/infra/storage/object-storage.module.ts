import { Global, Injectable, Logger, Module } from '@nestjs/common';
import type { ObjectStoragePort } from '@djafat/types';
import { AppConfigService } from '../../common/config/config.service';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/**
 * Bloc-0 placeholder for the S3-compatible adapter (decision A6 — no vendor SDK
 * in business code; the real adapter is isolated here). Methods throw until the
 * adapter is wired in a later block; nothing at Bloc 0 uploads files.
 */
@Injectable()
export class NotConfiguredObjectStorage implements ObjectStoragePort {
  private readonly logger = new Logger(NotConfiguredObjectStorage.name);
  constructor(config: AppConfigService) {
    this.logger.log(
      `Object storage target: ${config.get('OBJECT_STORAGE_ENDPOINT')} / bucket ${config.get('OBJECT_STORAGE_BUCKET')} (adapter not implemented at Bloc 0)`,
    );
  }
  putObject(): Promise<{ key: string }> {
    return Promise.reject(new Error('ObjectStoragePort not implemented at Bloc 0'));
  }
  getSignedUrl(): Promise<string> {
    return Promise.reject(new Error('ObjectStoragePort not implemented at Bloc 0'));
  }
  deleteObject(): Promise<void> {
    return Promise.reject(new Error('ObjectStoragePort not implemented at Bloc 0'));
  }
}

@Global()
@Module({
  providers: [{ provide: OBJECT_STORAGE, useClass: NotConfiguredObjectStorage }],
  exports: [OBJECT_STORAGE],
})
export class ObjectStorageModule {}
