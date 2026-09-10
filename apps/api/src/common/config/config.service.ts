import { Injectable } from '@nestjs/common';
import { type ApiEnv, loadApiEnv } from '@djafat/config';

/**
 * The ONE place env is read. Parsed & validated once at construction — the
 * process throws (and the API never binds a port) if the environment is invalid.
 */
@Injectable()
export class AppConfigService {
  private readonly env: ApiEnv;

  constructor() {
    this.env = loadApiEnv();
  }

  get all(): Readonly<ApiEnv> {
    return this.env;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get<K extends keyof ApiEnv>(key: K): ApiEnv[K] {
    return this.env[key];
  }
}
